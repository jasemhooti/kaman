import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  computeTrajectoryPreview,
  evaluateSegmentCollision,
  getBowLaunchOrigin,
  powerToSpeed,
  stepArrowPhysics,
  terrainHeightAt,
  type ArenaConfig,
  type ArcherState,
  type HitDetectionResult,
  type WeatherType,
} from './physics';
import {
  createArrowMesh,
  createCompositeArcher,
  createCompositeObstacle,
  createProceduralGrainTexture,
  detectSoftwareWebGL,
  stepRagdollPhysics,
  triggerArcherRagdoll,
  updateArcherPose,
  type ArcherRig,
  type ObstacleRig,
} from './scene3d';
import { soundEngine } from './sound';

export type CameraViewMode = 'auto' | 'overview' | 'focus';

export interface ActiveShotTrigger {
  shotId: number;
  shooterId: 1 | 2;
  angleDeg: number;
  powerPct: number;
}

export interface ArenaCanvasProps {
  appState: 'title' | 'playing' | 'paused' | 'gameover';
  arena: ArenaConfig;
  archers: [ArcherState, ArcherState];
  currentTurn: 1 | 2;
  windSpeed: number;
  weather: WeatherType;
  cameraMode: CameraViewMode;
  cinematicFollow: boolean;
  isAITurn: boolean;
  shotTrigger: ActiveShotTrigger | null;
  onAimChange: (angleDeg: number, powerPct: number) => void;
  onDragFire: () => void;
  onShotResolved: (result: HitDetectionResult, landingX: number) => void;
}

// Pre-allocated module-scope scratch objects to avoid GC in render loop
const _camTargetPos = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _posVec = new THREE.Vector3();
const _scaleVec = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  colorHex: number;
}

export const ArenaCanvas: React.FC<ArenaCanvasProps> = (props) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef<ArenaCanvasProps>(props);
  propsRef.current = props;

  // Track last handled shotId and arena seed inside refs so canvas never re-mounts
  const lastShotIdRef = useRef<number>(0);
  const rebuildSceneArenaRef = useRef<((arena: ArenaConfig, archers: [ArcherState, ArcherState]) => void) | null>(
    null
  );
  const launchArrowInternalRef = useRef<((trigger: ActiveShotTrigger) => void) | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x131b2e);
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(0x131b2e, 0.0085);

    // Mandatory studio environment map via RoomEnvironment + PMREMGenerator
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      42,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.5,
      300
    );
    camera.position.set(-4, 5.5, 29);
    const currentCamLook = new THREE.Vector3(-2, 2.2, 0);
    camera.lookAt(currentCamLook);

    // 3-Point Studio & Outdoor Canyon Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x3b2f26, 0.95);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffdfa8, 2.35);
    keyLight.position.set(22, 38, 26);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 5;
      keyLight.shadow.camera.far = 120;
      const d = 34;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
    rimLight.position.set(-28, 18, -22);
    scene.add(rimLight);

    // Procedural Textures
    const terrainTex = createProceduralGrainTexture(renderer, '#856647', '#5c432d', true);
    terrainTex.repeat.set(18, 6);
    const woodTex = createProceduralGrainTexture(renderer, '#7c4a24', '#472811', true);
    const stoneTex = createProceduralGrainTexture(renderer, '#64748b', '#475569', true);

    // Dynamic world group that holds terrain, obstacles, trees, and archers
    const worldGroup = new THREE.Group();
    scene.add(worldGroup);

    let archerRigs: [ArcherRig, ArcherRig] | null = null;
    let obstacleRigs: ObstacleRig[] = [];
    let treeInstancedMesh: THREE.InstancedMesh | null = null;
    const treeBasePositions: Array<{ x: number; y: number; z: number; scale: number }> = [];

    // Dashed Trajectory Preview Line (3 to 5 meters) + Endpoint Ring
    const previewMaxPoints = 32;
    const previewPositions = new Float32Array(previewMaxPoints * 3);
    const previewGeo = new THREE.BufferGeometry();
    previewGeo.setAttribute('position', new THREE.BufferAttribute(previewPositions, 3));
    const previewMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 0.32,
      gapSize: 0.18,
      transparent: true,
      opacity: 0.92,
    });
    const previewLine = new THREE.Line(previewGeo, previewMat);
    scene.add(previewLine);

    const previewTipGeo = new THREE.RingGeometry(0.12, 0.22, 16);
    const previewTipMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
    });
    const previewTipMesh = new THREE.Mesh(previewTipGeo, previewTipMat);
    scene.add(previewTipMesh);

    // Active Flying Arrow Mesh + Ribbon Trail
    const flyingArrow = createArrowMesh();
    flyingArrow.visible = false;
    scene.add(flyingArrow);

    const MAX_STUCK_ARROWS = 14;
    const stuckArrows: THREE.Group[] = [];

    // Zero-GC Pooled Impact Particle Ring Buffer (InstancedMesh of 64 cubes)
    const PARTICLE_COUNT = 64;
    const particleGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.2,
    });
    const particleInstanced = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
    particleInstanced.frustumCulled = false;
    scene.add(particleInstanced);

    const particlePool: PooledParticle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      active: false,
      x: 0,
      y: -100,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
      size: 1,
      colorHex: 0xfbbf24,
    }));
    let particleCursor = 0;

    const spawnParticles = (
      x: number,
      y: number,
      z: number,
      count: number,
      colorHex: number,
      speedScale = 1
    ) => {
      for (let i = 0; i < count; i++) {
        const p = particlePool[particleCursor];
        particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        const angle = Math.random() * Math.PI * 2;
        const spd = (1.8 + Math.random() * 5.2) * speedScale;
        p.vx = Math.cos(angle) * spd;
        p.vy = (1.5 + Math.random() * 4.8) * speedScale;
        p.vz = (Math.random() - 0.5) * 4.5 * speedScale;
        p.life = 0;
        p.maxLife = 0.38 + Math.random() * 0.42;
        p.size = 0.65 + Math.random() * 1.1;
        p.colorHex = colorHex;
      }
    };

    // Weather Wind/Dust/Rain Particle InstancedMesh (140 ambient particles)
    const WEATHER_COUNT = 140;
    const weatherGeo = new THREE.BoxGeometry(0.38, 0.04, 0.04);
    const weatherMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.42,
    });
    const weatherInstanced = new THREE.InstancedMesh(weatherGeo, weatherMat, WEATHER_COUNT);
    weatherInstanced.frustumCulled = false;
    scene.add(weatherInstanced);

    const weatherParticles = Array.from({ length: WEATHER_COUNT }, (_, i) => ({
      x: ((i * 19) % 90) - 45,
      y: ((i * 7) % 24) - 2,
      z: ((i * 13) % 26) - 14,
      speedMult: 0.75 + (i % 5) * 0.14,
    }));

    // Build / Rebuild Arena Geometry
    const buildArenaScene = (arena: ArenaConfig, archers: [ArcherState, ArcherState]) => {
      while (worldGroup.children.length > 0) {
        const child = worldGroup.children[0];
        worldGroup.remove(child);
      }
      while (stuckArrows.length > 0) {
        const arr = stuckArrows.pop()!;
        scene.remove(arr);
      }
      // Clean up any detached ragdoll limbs from scene
      if (archerRigs) {
        for (const rig of archerRigs) {
          for (const limb of rig.ragdollLimbs) {
            scene.remove(limb.mesh);
          }
        }
      }

      // 1. Continuous 3D Extruded / Displaced Canyon Terrain
      const segsX = 110;
      const segsZ = 22;
      const widthX = 120;
      const depthZ = 44;
      const terrainGeo = new THREE.PlaneGeometry(widthX, depthZ, segsX, segsZ);
      terrainGeo.rotateX(-Math.PI / 2);

      const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const baseH = terrainHeightAt(vx, arena);
        // Raise natural canyon walls behind the play line (z < -4) and drop foreground cliff (z > 4)
        let zOffset = 0;
        if (vz < -3.5) {
          const backDist = Math.abs(vz + 3.5);
          zOffset =
            Math.pow(backDist * 0.25, 1.55) +
            Math.sin(vx * 0.14 + vz * 0.2) * 1.4;
        } else if (vz > 3.5) {
          const frontDist = vz - 3.5;
          zOffset = -Math.pow(frontDist * 0.22, 1.3);
        }
        posAttr.setY(i, baseH + zOffset);
      }
      terrainGeo.computeVertexNormals();

      const terrainMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: terrainTex,
        bumpMap: terrainTex,
        bumpScale: 0.15,
        roughness: 0.88,
        metalness: 0.05,
      });
      const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
      terrainMesh.receiveShadow = !isSoftwareGl;
      worldGroup.add(terrainMesh);

      // 2. Stone Bastion Platforms directly under each Archer's feet so they stand on proud pedestals
      const pedestalGeo = new THREE.CylinderGeometry(1.65, 2.05, 1.2, 12);
      const pedestalMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneTex,
        roughness: 0.8,
        metalness: 0.12,
      });
      for (const arch of archers) {
        const ped = new THREE.Mesh(pedestalGeo, pedestalMat);
        ped.position.set(arch.x, arch.y - 0.58, 0);
        ped.receiveShadow = !isSoftwareGl;
        ped.castShadow = !isSoftwareGl;
        worldGroup.add(ped);
      }

      // 3. Distant Canyon Landmark Spires & Citadel Silhouette Towers
      const spireMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.9,
        metalness: 0.08,
      });
      const landmarkPositions = [
        { x: -34, z: -22, r: 7, h: 24 },
        { x: -12, z: -26, r: 9, h: 30 },
        { x: 14, z: -24, r: 8, h: 27 },
        { x: 36, z: -21, r: 7, h: 22 },
      ];
      for (const lm of landmarkPositions) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(lm.r, lm.h, 7), spireMat);
        cone.position.set(lm.x, lm.h * 0.38, lm.z);
        worldGroup.add(cone);
      }

      // 4. Instanced Cypress/Pine Trees along background ridge (28 instances: trunks + canopies)
      const treeCount = 28;
      const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.1, 6);
      trunkGeo.translate(0, 0.55, 0);
      const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x4a2e19,
        roughness: 0.9,
        metalness: 0.05,
      });
      const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
      trunkInstanced.frustumCulled = false;

      const foliageGeo = new THREE.ConeGeometry(0.88, 3.2, 7);
      foliageGeo.translate(0, 2.1, 0);
      const foliageMat = new THREE.MeshStandardMaterial({
        color: 0x2d5a27,
        roughness: 0.85,
        metalness: 0.05,
      });
      treeInstancedMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
      treeInstancedMesh.frustumCulled = false;
      treeBasePositions.length = 0;

      for (let i = 0; i < treeCount; i++) {
        const tx = -42 + i * 3.1 + ((i * 7) % 3) * 0.4;
        const tz = -5.5 - (i % 4) * 2.4;
        const ty = terrainHeightAt(tx, arena) + Math.pow(Math.abs(tz + 3.5) * 0.25, 1.55) - 0.35;
        const sc = 0.78 + (i % 5) * 0.12;
        treeBasePositions.push({ x: tx, y: ty, z: tz, scale: sc });

        _posVec.set(tx, ty, tz);
        _scaleVec.set(sc, sc, sc);
        _quat.identity();
        _mat4.compose(_posVec, _quat, _scaleVec);
        trunkInstanced.setMatrixAt(i, _mat4);
        treeInstancedMesh.setMatrixAt(i, _mat4);
        _color.setHSL(0.31 + (i % 3) * 0.02, 0.48, 0.36 + (i % 4) * 0.05);
        treeInstancedMesh.setColorAt(i, _color);
      }
      trunkInstanced.instanceMatrix.needsUpdate = true;
      treeInstancedMesh.instanceMatrix.needsUpdate = true;
      if (treeInstancedMesh.instanceColor) treeInstancedMesh.instanceColor.needsUpdate = true;
      worldGroup.add(trunkInstanced);
      worldGroup.add(treeInstancedMesh);

      // 5. Destructible Obstacles
      obstacleRigs = arena.obstacles.map((obs) => {
        const rig = createCompositeObstacle(obs, woodTex, stoneTex, isSoftwareGl);
        rig.group.visible = !obs.destroyed;
        worldGroup.add(rig.group);
        return rig;
      });

      // 6. Composite 3D Archers
      const rig1 = createCompositeArcher(true, isSoftwareGl);
      const rig2 = createCompositeArcher(false, isSoftwareGl);
      worldGroup.add(rig1.root);
      worldGroup.add(rig2.root);
      archerRigs = [rig1, rig2];
      updateArcherPose(rig1, archers[0], true, 0);
      updateArcherPose(rig2, archers[1], false, 0);
    };

    buildArenaScene(propsRef.current.arena, propsRef.current.archers);
    rebuildSceneArenaRef.current = buildArenaScene;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Active Arrow Flight Simulation State
    let activeFlight: {
      shooterId: 1 | 2;
      x: number;
      y: number;
      vx: number;
      vy: number;
      angleRad: number;
      postImpactTimer: number;
      resolvedResult: HitDetectionResult | null;
    } | null = null;

    let hitstopTimer = 0;
    let cameraTrauma = 0;

    launchArrowInternalRef.current = (trigger: ActiveShotTrigger) => {
      const { archers, windSpeed } = propsRef.current;
      const shooter = archers[trigger.shooterId - 1];
      const origin = getBowLaunchOrigin(shooter);
      const speed = powerToSpeed(trigger.powerPct);
      const rad = THREE.MathUtils.degToRad(trigger.angleDeg);

      activeFlight = {
        shooterId: trigger.shooterId,
        x: origin.x,
        y: origin.y,
        vx: Math.cos(rad) * speed * shooter.facing,
        vy: Math.sin(rad) * speed,
        angleRad: shooter.facing === 1 ? rad : Math.PI - rad,
        postImpactTimer: 0,
        resolvedResult: null,
      };

      // Hide nocked arrow on shooter bow while arrow is in flight
      if (archerRigs) {
        archerRigs[trigger.shooterId - 1].nockedArrow.visible = false;
      }

      flyingArrow.visible = true;
      flyingArrow.position.set(origin.x, origin.y, 0);
      flyingArrow.rotation.z = activeFlight.angleRad;

      soundEngine.playBowRelease(trigger.powerPct);
      soundEngine.startArrowWhistle();
      spawnParticles(origin.x, origin.y, 0, 6, 0xfbbf24, 0.55);
    };

    // Drag-and-Release Aiming on Canvas
    let isDraggingAim = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartAngle = 45;
    let dragStartPower = 70;

    const onPointerDown = (e: PointerEvent) => {
      const p = propsRef.current;
      if (p.appState !== 'playing' || p.isAITurn || activeFlight) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      isDraggingAim = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const activeArcher = p.archers[p.currentTurn - 1];
      dragStartAngle = activeArcher.angleDeg;
      dragStartPower = activeArcher.powerPct;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingAim) return;
      const p = propsRef.current;
      if (p.appState !== 'playing' || p.isAITurn || activeFlight) {
        isDraggingAim = false;
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const dx = (e.clientX - dragStartX) / Math.max(240, rect.width);
      const dy = (e.clientY - dragStartY) / Math.max(240, rect.height);

      const activeArcher = p.archers[p.currentTurn - 1];
      // Pulling backward against facing direction increases power; pulling downward/upward adjusts elevation angle
      const pullDelta = -dx * activeArcher.facing * 130;
      const elevDelta = -dy * 115;

      const newAngle = Math.round(Math.max(5, Math.min(85, dragStartAngle + elevDelta)));
      const newPower = Math.round(Math.max(15, Math.min(100, dragStartPower + pullDelta)));

      soundEngine.playBowDrawCreak(newPower);
      p.onAimChange(newAngle, newPower);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDraggingAim) return;
      isDraggingAim = false;
      renderer.domElement.releasePointerCapture?.(e.pointerId);
      const distDragged = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
      // If user dragged significantly (> 45px) and released, fire arrow!
      if (distDragged > 45) {
        propsRef.current.onDragFire();
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // ResizeObserver for crisp responsive viewport
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    // Main Simulation & Render Loop (with Software-WebGL afterDraw Pacing)
    let frameId = 0;
    let isUnmounted = false;
    const startTimeMs = performance.now();
    let lastFrameMs = startTimeMs;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isUnmounted) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (isUnmounted) return;
      const nowMs = performance.now();
      const rawDt = (nowMs - lastFrameMs) / 1000;
      lastFrameMs = nowMs;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      const elapsed = (nowMs - startTimeMs) / 1000;
      const currentProps = propsRef.current;

      // Update Weather Atmosphere & Wind Particles
      if (currentProps.weather === 'dust') {
        skyColor.setHex(0x281d15);
        weatherMat.color.setHex(0xfde68a);
      } else if (currentProps.weather === 'rain') {
        skyColor.setHex(0x0f172a);
        weatherMat.color.setHex(0x93c5fd);
      } else {
        skyColor.setHex(0x162038);
        weatherMat.color.setHex(0xe2e8f0);
      }
      scene.background = skyColor;
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.copy(skyColor);
      }

      // Animate trees swaying with windSpeed
      if (treeInstancedMesh) {
        const windLean = currentProps.windSpeed * 0.025;
        for (let i = 0; i < treeBasePositions.length; i++) {
          const tb = treeBasePositions[i];
          _posVec.set(tb.x, tb.y, tb.z);
          _scaleVec.set(tb.scale, tb.scale, tb.scale);
          const sway = windLean + Math.sin(elapsed * 2.2 + i) * 0.04;
          _euler.set(0, 0, -sway);
          _quat.setFromEuler(_euler);
          _mat4.compose(_posVec, _quat, _scaleVec);
          treeInstancedMesh.setMatrixAt(i, _mat4);
        }
        treeInstancedMesh.instanceMatrix.needsUpdate = true;
      }

      // Animate ambient wind/rain/dust streaks
      const windVelX = currentProps.windSpeed * 1.85;
      const fallVelY = currentProps.weather === 'rain' ? -14.0 : -0.6;
      const streakTilt =
        currentProps.weather === 'rain'
          ? Math.atan2(fallVelY, windVelX || 0.1)
          : Math.sin(elapsed + 1) * 0.1;

      for (let i = 0; i < WEATHER_COUNT; i++) {
        const wp = weatherParticles[i];
        wp.x += windVelX * wp.speedMult * dt;
        wp.y += fallVelY * wp.speedMult * dt;
        if (wp.x > 46) wp.x = -46;
        if (wp.x < -46) wp.x = 46;
        if (wp.y < -2) wp.y = 22;
        if (wp.y > 22) wp.y = -2;

        _posVec.set(wp.x, wp.y, wp.z);
        _euler.set(0, 0, streakTilt);
        _quat.setFromEuler(_euler);
        _scaleVec.set(
          1 + Math.abs(currentProps.windSpeed) * 0.18,
          currentProps.weather === 'rain' ? 2.2 : 1.0,
          1
        );
        _mat4.compose(_posVec, _quat, _scaleVec);
        weatherInstanced.setMatrixAt(i, _mat4);
      }
      weatherInstanced.instanceMatrix.needsUpdate = true;

      // Update Archer Poses, Hit Flashes & Ragdoll Physics
      if (archerRigs) {
        for (let idx = 0; idx < 2; idx++) {
          const rig = archerRigs[idx];
          const arch = currentProps.archers[idx];
          updateArcherPose(rig, arch, currentProps.currentTurn === arch.id, elapsed);
          stepRagdollPhysics(rig, currentProps.arena, dt);

          if (rig.flashTimer > 0) {
            rig.flashTimer = Math.max(0, rig.flashTimer - dt);
            const isWhite = rig.flashTimer > 0;
            rig.hitFlashMaterials.forEach((mat, mIdx) => {
              mat.color.setHex(isWhite ? 0xffffff : rig.baseColors[mIdx]);
              mat.emissive.setHex(isWhite ? 0xffedd5 : 0x000000);
            });
          }
        }
      }

      // Update Obstacle Hit Flashes & Visibility
      for (let i = 0; i < obstacleRigs.length; i++) {
        const oRig = obstacleRigs[i];
        const obsData = currentProps.arena.obstacles[i];
        if (obsData) {
          oRig.group.visible = !obsData.destroyed;
        }
        if (oRig.flashTimer > 0) {
          oRig.flashTimer = Math.max(0, oRig.flashTimer - dt);
          const isFlash = oRig.flashTimer > 0;
          oRig.materials.forEach((m, mIdx) => {
            m.color.setHex(isFlash ? 0xffffff : oRig.baseColors[mIdx]);
          });
        }
      }

      // Update Short Dashed Trajectory Preview (3 to 5 meters)
      const showPreview =
        currentProps.appState === 'playing' && !activeFlight && !currentProps.isAITurn;
      previewLine.visible = showPreview;
      previewTipMesh.visible = showPreview;

      if (showPreview) {
        const activeArcher = currentProps.archers[currentProps.currentTurn - 1];
        const origin = getBowLaunchOrigin(activeArcher);
        const pts = computeTrajectoryPreview(
          origin,
          activeArcher.angleDeg,
          activeArcher.powerPct,
          activeArcher.facing,
          currentProps.windSpeed,
          4.2
        );
        const lastPt = pts[pts.length - 1] || origin;
        for (let i = 0; i < previewMaxPoints; i++) {
          const pt = pts[Math.min(i, pts.length - 1)];
          previewPositions[i * 3] = pt.x;
          previewPositions[i * 3 + 1] = pt.y;
          previewPositions[i * 3 + 2] = 0;
        }
        (previewLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        previewLine.computeLineDistances();

        previewTipMesh.position.set(lastPt.x, lastPt.y, 0);
      }

      // Sim-level Hitstop & Active Arrow Ballistics
      if (hitstopTimer > 0) {
        hitstopTimer = Math.max(0, hitstopTimer - dt);
      } else if (activeFlight && currentProps.appState !== 'paused') {
        if (!activeFlight.resolvedResult) {
          const next = stepArrowPhysics(activeFlight, currentProps.windSpeed, dt);
          soundEngine.updateArrowWhistle(Math.hypot(next.vx, next.vy), next.y);

          const hit = evaluateSegmentCollision(
            activeFlight.x,
            activeFlight.y,
            next.x,
            next.y,
            next.vx,
            next.vy,
            activeFlight.shooterId,
            currentProps.archers,
            currentProps.arena
          );

          activeFlight.x = next.x;
          activeFlight.y = next.y;
          activeFlight.vx = next.vx;
          activeFlight.vy = next.vy;
          activeFlight.angleRad = next.angleRad;

          flyingArrow.position.set(activeFlight.x, activeFlight.y, 0);
          flyingArrow.rotation.z = activeFlight.angleRad;

          if (hit.hitType !== 'none' || Math.abs(next.x) > currentProps.arena.distance * 1.25 || next.y < -18) {
            const finalHit: HitDetectionResult =
              hit.hitType !== 'none'
                ? hit
                : { hitType: 'terrain', impactPoint: { x: next.x, y: next.y } };

            activeFlight.resolvedResult = finalHit;
            activeFlight.postImpactTimer = 0.55;
            flyingArrow.position.set(finalHit.impactPoint.x, finalHit.impactPoint.y, 0);

            // Spawn stuck arrow at impact point
            const stuck = createArrowMesh();
            stuck.position.set(finalHit.impactPoint.x, finalHit.impactPoint.y, 0);
            stuck.rotation.z = activeFlight.angleRad;
            scene.add(stuck);
            stuckArrows.push(stuck);
            if (stuckArrows.length > MAX_STUCK_ARROWS) {
              const oldest = stuckArrows.shift()!;
              scene.remove(oldest);
            }
            flyingArrow.visible = false;

            // Trigger Weight-Scaled Juice: Audio + Hit Flash + Hitstop + Trauma Shake + Particles
            if (finalHit.hitType === 'archer' && finalHit.targetArcherId && archerRigs) {
              const targetRig = archerRigs[finalHit.targetArcherId - 1];
              const targetArch = currentProps.archers[finalHit.targetArcherId - 1];
              targetRig.flashTimer = 0.14;
              const isHead = finalHit.hitZone === 'head';
              const isLethal = targetArch.hp - (finalHit.damage || 0) <= 0;

              hitstopTimer = isHead || isLethal ? 0.075 : 0.045;
              cameraTrauma = isHead || isLethal ? 0.85 : 0.55;
              soundEngine.playImpactFlesh(isHead);

              spawnParticles(
                finalHit.impactPoint.x,
                finalHit.impactPoint.y,
                0,
                isHead ? 26 : 16,
                isHead ? 0xef4444 : 0xf97316,
                isHead ? 1.35 : 1.0
              );

              if (isLethal) {
                triggerArcherRagdoll(targetRig, scene, activeFlight.vx, activeFlight.vy);
              }
            } else if (finalHit.hitType === 'obstacle' && finalHit.obstacleId) {
              const obsIdx = currentProps.arena.obstacles.findIndex((o) => o.id === finalHit.obstacleId);
              const obs = currentProps.arena.obstacles[obsIdx];
              const oRig = obstacleRigs[obsIdx];
              if (oRig) oRig.flashTimer = 0.12;
              const willDestroy = obs ? obs.hp - (finalHit.damage || 30) <= 0 : false;
              hitstopTimer = willDestroy ? 0.05 : 0.025;
              cameraTrauma = willDestroy ? 0.5 : 0.28;

              if (obs?.kind === 'barrel') {
                soundEngine.playImpactWood(willDestroy);
                spawnParticles(finalHit.impactPoint.x, finalHit.impactPoint.y, 0, willDestroy ? 22 : 10, 0xb45309, 1.1);
              } else {
                soundEngine.playImpactStone(willDestroy);
                spawnParticles(finalHit.impactPoint.x, finalHit.impactPoint.y, 0, willDestroy ? 24 : 12, 0x94a3b8, 1.1);
              }
            } else {
              cameraTrauma = 0.18;
              soundEngine.playImpactDirt();
              spawnParticles(finalHit.impactPoint.x, finalHit.impactPoint.y, 0, 10, 0xd6a77a, 0.75);
            }
          }
        } else {
          activeFlight.postImpactTimer -= dt;
          if (activeFlight.postImpactTimer <= 0) {
            const res = activeFlight.resolvedResult;
            const landX = res.impactPoint.x;
            const shooterIdx = activeFlight.shooterId - 1;
            activeFlight = null;
            if (archerRigs && !archerRigs[shooterIdx].ragdollActive) {
              archerRigs[shooterIdx].nockedArrow.visible = true;
            }
            currentProps.onShotResolved(res, landX);
          }
        }
      }

      // Step Pooled Impact Particles
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particlePool[i];
        if (!p.active) {
          _posVec.set(0, -200, 0);
          _scaleVec.set(0.001, 0.001, 0.001);
          _quat.identity();
          _mat4.compose(_posVec, _quat, _scaleVec);
          particleInstanced.setMatrixAt(i, _mat4);
          continue;
        }
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          continue;
        }
        p.vy -= 9.81 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const shrink = (1 - p.life / p.maxLife) * p.size;
        _posVec.set(p.x, p.y, p.z);
        _scaleVec.set(shrink, shrink, shrink);
        _quat.identity();
        _mat4.compose(_posVec, _quat, _scaleVec);
        particleInstanced.setMatrixAt(i, _mat4);
        _color.setHex(p.colorHex);
        particleInstanced.setColorAt(i, _color);
      }
      particleInstanced.instanceMatrix.needsUpdate = true;
      if (particleInstanced.instanceColor) particleInstanced.instanceColor.needsUpdate = true;

      // Dynamic 2.5D / 3D Camera Choreography with Exponential Damping
      const dist = currentProps.arena.distance;
      const p1 = currentProps.archers[0];
      const p2 = currentProps.archers[1];
      const activeArcher = currentProps.archers[currentProps.currentTurn - 1];
      const midY = (p1.y + p2.y) * 0.5 + 2.2;

      if (currentProps.appState === 'title') {
        // Stage 1: Live World Camera Spline Pan on Title Screen (frames left archer & canyon vista prominently)
        const panX = -4 + Math.sin(elapsed * 0.35) * 8;
        const panZ = 28 + Math.cos(elapsed * 0.25) * 4;
        _camTargetPos.set(panX, midY + 1.8, panZ);
        _camLookTarget.set(panX * 0.5 - 3, midY - 0.8, 0);
      } else if (activeFlight && currentProps.cinematicFollow) {
        // Cinematic Arrow Follow Camera
        const arrowX = activeFlight.x;
        const arrowY = Math.max(midY - 1, activeFlight.y);
        const zoomZ = activeFlight.resolvedResult ? 17 : 23;
        _camTargetPos.set(arrowX * 0.88, arrowY + 2.4, zoomZ);
        _camLookTarget.set(arrowX, arrowY + 0.4, 0);
      } else if (currentProps.cameraMode === 'focus') {
        // Focused on current turn archer with depth perspective toward target
        const focusX = activeArcher.x * 0.62;
        _camTargetPos.set(focusX, activeArcher.y + 4.2, 28);
        _camLookTarget.set(activeArcher.x * 0.25, midY, 0);
      } else if (currentProps.cameraMode === 'overview') {
        // Full Side-View 2.5D Overview showing both archers and the valley
        const requiredZ = Math.max(46, dist * 1.16);
        _camTargetPos.set(0, midY + 3.2, requiredZ);
        _camLookTarget.set(0, midY - 0.4, 0);
      } else {
        // 'auto': Wide 2.5D Side-View that keeps both archers inside the frame with subtle turn bias
        const biasX = activeArcher.x * 0.05;
        const requiredZ = Math.max(45, dist * 1.12);
        _camTargetPos.set(biasX, midY + 3.0, requiredZ);
        _camLookTarget.set(biasX * 0.3, midY - 0.3, 0);
      }

      const dampFactor = 1 - Math.exp(-5.5 * dt);
      camera.position.lerp(_camTargetPos, dampFactor);
      currentCamLook.lerp(_camLookTarget, dampFactor);

      // Apply decaying trauma*trauma rotational & positional shake on heavy impacts
      if (cameraTrauma > 0) {
        cameraTrauma = Math.max(0, cameraTrauma - dt * 1.8);
        const shake = cameraTrauma * cameraTrauma * 0.65;
        camera.position.x += Math.sin(elapsed * 55) * shake;
        camera.position.y += Math.cos(elapsed * 63) * shake;
      }

      camera.lookAt(currentCamLook);
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      isUnmounted = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      soundEngine.stopArrowWhistle();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Rebuild 3D arena when arena.seed changes
  const prevSeedRef = useRef<number>(props.arena.seed);
  useEffect(() => {
    if (props.arena.seed !== prevSeedRef.current) {
      prevSeedRef.current = props.arena.seed;
      rebuildSceneArenaRef.current?.(props.arena, props.archers);
    }
  }, [props.arena, props.archers]);

  // Trigger arrow launch when shotTrigger.shotId increments
  useEffect(() => {
    if (props.shotTrigger && props.shotTrigger.shotId !== lastShotIdRef.current) {
      lastShotIdRef.current = props.shotTrigger.shotId;
      launchArrowInternalRef.current?.(props.shotTrigger);
    }
  }, [props.shotTrigger]);

  return (
    <div
      ref={mountRef}
      data-testid="arena-canvas-container"
      className="fixed inset-0 w-screen h-screen overflow-hidden cursor-crosshair"
    />
  );
};
