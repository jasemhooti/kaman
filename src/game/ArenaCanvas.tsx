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
  createCloudCluster,
  createCompositeArcher,
  createCompositeObstacle,
  createProceduralGrainTexture,
  createSkyDome,
  createTorchBrazier,
  createWarBanner,
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
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const initW = container.clientWidth || window.innerWidth;
    const initH = container.clientHeight || window.innerHeight;
    renderer.setSize(initW, initH);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x1e2542);
    scene.background = fogColor;
    scene.fog = new THREE.FogExp2(0x1e2542, 0.0065);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Atmospheric Gradient Sky Dome Shader
    const { domeGroup, updateSkyWeather } = createSkyDome();
    scene.add(domeGroup);

    const initAspect = initW / initH;
    const camera = new THREE.PerspectiveCamera(initAspect < 1 ? 58 : 42, initAspect, 0.5, 320);
    camera.position.set(-28, 7.5, 5.2);
    const currentCamLook = new THREE.Vector3(-8, 2.5, 0);
    camera.lookAt(currentCamLook);

    // 3-Point Studio & Golden Hour Canyon Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x452719, 1.05);
    hemiLight.position.set(0, 55, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffe4b5, 2.55);
    keyLight.position.set(18, 42, 28);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 5;
      keyLight.shadow.camera.far = 130;
      const d = 34;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.95);
    rimLight.position.set(-28, 22, -24);
    scene.add(rimLight);

    // Rich Procedural Textures
    const terrainTex = createProceduralGrainTexture(renderer, '#9a714c', '#68492e', true, 'terrain');
    terrainTex.repeat.set(20, 8);
    const woodTex = createProceduralGrainTexture(renderer, '#854d27', '#4a2511', true, 'wood');
    const stoneTex = createProceduralGrainTexture(renderer, '#64748b', '#334155', true, 'stone');

    const worldGroup = new THREE.Group();
    scene.add(worldGroup);

    let archerRigs: [ArcherRig, ArcherRig] | null = null;
    let obstacleRigs: ObstacleRig[] = [];
    let treeInstancedMesh: THREE.InstancedMesh | null = null;
    const treeBasePositions: Array<{ x: number; y: number; z: number; scale: number }> = [];
    const brazierFlames: THREE.Mesh[] = [];
    const warBannerCloths: THREE.Mesh[] = [];
    const cloudClusters: Array<{ group: THREE.Group; speedFactor: number }> = [];

    // Dashed Trajectory Preview Line (3 to 5 meters) + Glowing Aim Ring
    const previewMaxPoints = 32;
    const previewPositions = new Float32Array(previewMaxPoints * 3);
    const previewGeo = new THREE.BufferGeometry();
    previewGeo.setAttribute('position', new THREE.BufferAttribute(previewPositions, 3));
    const previewMat = new THREE.LineDashedMaterial({
      color: 0xfde047,
      dashSize: 0.3,
      gapSize: 0.16,
      transparent: true,
      opacity: 0.95,
    });
    const previewLine = new THREE.Line(previewGeo, previewMat);
    scene.add(previewLine);

    const previewTipGeo = new THREE.RingGeometry(0.14, 0.26, 20);
    const previewTipMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      side: THREE.DoubleSide,
    });
    const previewTipMesh = new THREE.Mesh(previewTipGeo, previewTipMat);
    scene.add(previewTipMesh);

    // Active Flying Arrow Mesh + Glowing Flight Trail Ribbon
    const flyingArrow = createArrowMesh();
    flyingArrow.visible = false;
    scene.add(flyingArrow);

    const TRAIL_LENGTH = 20;
    const trailPositions = new Float32Array(TRAIL_LENGTH * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.85,
    });
    const arrowTrailLine = new THREE.Line(trailGeo, trailMat);
    arrowTrailLine.visible = false;
    scene.add(arrowTrailLine);
    const trailHistory: Array<{ x: number; y: number; z: number }> = [];

    const MAX_STUCK_ARROWS = 14;
    const stuckArrows: THREE.Group[] = [];

    // Zero-GC Pooled Impact Particle Ring Buffer
    const PARTICLE_COUNT = 72;
    const particleGeo = new THREE.DodecahedronGeometry(0.13, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.25,
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
        const spd = (1.8 + Math.random() * 5.5) * speedScale;
        p.vx = Math.cos(angle) * spd;
        p.vy = (1.6 + Math.random() * 5.0) * speedScale;
        p.vz = (Math.random() - 0.5) * 4.5 * speedScale;
        p.life = 0;
        p.maxLife = 0.42 + Math.random() * 0.45;
        p.size = 0.7 + Math.random() * 1.15;
        p.colorHex = colorHex;
      }
    };

    // Weather Wind/Dust/Rain Particle InstancedMesh
    const WEATHER_COUNT = 140;
    const weatherGeo = new THREE.BoxGeometry(0.42, 0.045, 0.045);
    const weatherMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.48,
    });
    const weatherInstanced = new THREE.InstancedMesh(weatherGeo, weatherMat, WEATHER_COUNT);
    weatherInstanced.frustumCulled = false;
    scene.add(weatherInstanced);

    const weatherParticles = Array.from({ length: WEATHER_COUNT }, (_, i) => ({
      x: ((i * 19) % 90) - 45,
      y: ((i * 7) % 26) - 2,
      z: ((i * 13) % 28) - 15,
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
      if (archerRigs) {
        for (const rig of archerRigs) {
          for (const limb of rig.ragdollLimbs) {
            scene.remove(limb.mesh);
          }
        }
      }
      brazierFlames.length = 0;
      warBannerCloths.length = 0;
      cloudClusters.length = 0;

      // 1. Continuous 3D Canyon Terrain with Vertex Color Strata
      const segsX = 116;
      const segsZ = 24;
      const widthX = 128;
      const depthZ = 48;
      const terrainGeo = new THREE.PlaneGeometry(widthX, depthZ, segsX, segsZ);
      terrainGeo.rotateX(-Math.PI / 2);

      const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(posAttr.count * 3);

      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const baseH = terrainHeightAt(vx, arena);
        let zOffset = 0;
        if (vz < -3.5) {
          const backDist = Math.abs(vz + 3.5);
          zOffset =
            Math.pow(backDist * 0.26, 1.55) +
            Math.sin(vx * 0.14 + vz * 0.2) * 1.5;
        } else if (vz > 3.5) {
          const frontDist = vz - 3.5;
          zOffset = -Math.pow(frontDist * 0.22, 1.3);
        }
        const finalY = baseH + zOffset;
        posAttr.setY(i, finalY);

        // Vertex color tint: grassy moss on high plateaus, warm sandstone on slopes, dark slate in deep gorge
        if (finalY > 2.2 && Math.abs(vz) < 4.5) {
          _color.setHex(0x658354);
        } else if (finalY < -0.8) {
          _color.setHex(0x57534e);
        } else {
          _color.setHex(0xd6b48a);
        }
        colors[i * 3] = _color.r;
        colors[i * 3 + 1] = _color.g;
        colors[i * 3 + 2] = _color.b;
      }
      terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      terrainGeo.computeVertexNormals();

      const terrainMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        map: terrainTex,
        bumpMap: terrainTex,
        bumpScale: 0.18,
        roughness: 0.84,
        metalness: 0.06,
      });
      const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
      terrainMesh.receiveShadow = !isSoftwareGl;
      worldGroup.add(terrainMesh);

      // 2. Fortified Stone Bastion Pedestals + Fire Braziers + Wind War Banners under each Archer
      const pedestalGeo = new THREE.CylinderGeometry(1.75, 2.2, 1.6, 14);
      const pedestalMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneTex,
        bumpMap: stoneTex,
        bumpScale: 0.08,
        roughness: 0.76,
        metalness: 0.15,
      });
      const trimRingGeo = new THREE.CylinderGeometry(1.82, 1.82, 0.16, 14);
      const trimRingMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        roughness: 0.3,
        metalness: 0.8,
      });

      archers.forEach((arch, idx) => {
        const ped = new THREE.Mesh(pedestalGeo, pedestalMat);
        ped.position.set(arch.x, arch.y - 0.78, 0);
        ped.receiveShadow = !isSoftwareGl;
        ped.castShadow = !isSoftwareGl;
        worldGroup.add(ped);

        const ring = new THREE.Mesh(trimRingGeo, trimRingMat);
        ring.position.set(arch.x, arch.y - 0.06, 0);
        worldGroup.add(ring);

        // Flickering Fire Brazier beside each bastion
        const brazier = createTorchBrazier();
        brazier.group.position.set(arch.x - arch.facing * 1.15, arch.y, -0.95);
        worldGroup.add(brazier.group);
        brazierFlames.push(brazier.flameMesh);

        // Wind-Reactive War Banner behind each archer
        const banner = createWarBanner(idx === 0);
        banner.group.position.set(arch.x - arch.facing * 1.35, arch.y, 0.85);
        worldGroup.add(banner.group);
        warBannerCloths.push(banner.clothMesh);
      });

      // 3. Distant Canyon Citadel Towers & Mountain Peaks (Tall vertical silhouettes for Portrait Mode!)
      const spireMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        map: stoneTex,
        roughness: 0.88,
        metalness: 0.1,
      });
      const landmarkPositions = [
        { x: -36, z: -22, r: 8, h: 28 },
        { x: -14, z: -26, r: 10, h: 35 },
        { x: 0, z: -28, r: 7, h: 26 },
        { x: 15, z: -25, r: 9.5, h: 33 },
        { x: 37, z: -21, r: 8, h: 26 },
      ];
      for (const lm of landmarkPositions) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(lm.r, lm.h, 7), spireMat);
        cone.position.set(lm.x, lm.h * 0.4, lm.z);
        worldGroup.add(cone);
      }

      // 4. Volumetric 3D Cloud Clusters in the Upper Sky (6 clusters)
      for (let c = 0; c < 6; c++) {
        const cloud = createCloudCluster();
        cloud.position.set(-40 + c * 16, 15 + (c % 3) * 3.5, -14 - (c % 2) * 6);
        const sc = 0.85 + (c % 3) * 0.22;
        cloud.scale.set(sc, sc, sc);
        worldGroup.add(cloud);
        cloudClusters.push({ group: cloud, speedFactor: 0.4 + (c % 3) * 0.18 });
      }

      // 5. Instanced Cypress/Pine Trees along background ridge (32 instances)
      const treeCount = 32;
      const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.15, 6);
      trunkGeo.translate(0, 0.57, 0);
      const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x4a2e19,
        roughness: 0.9,
        metalness: 0.05,
      });
      const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
      trunkInstanced.frustumCulled = false;

      const foliageGeo = new THREE.ConeGeometry(0.92, 3.4, 7);
      foliageGeo.translate(0, 2.15, 0);
      const foliageMat = new THREE.MeshStandardMaterial({
        color: 0x2d5a27,
        roughness: 0.82,
        metalness: 0.06,
      });
      treeInstancedMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
      treeInstancedMesh.frustumCulled = false;
      treeBasePositions.length = 0;

      for (let i = 0; i < treeCount; i++) {
        const tx = -44 + i * 2.85 + ((i * 7) % 3) * 0.4;
        const tz = -5.2 - (i % 4) * 2.3;
        const ty = terrainHeightAt(tx, arena) + Math.pow(Math.abs(tz + 3.5) * 0.26, 1.55) - 0.35;
        const sc = 0.8 + (i % 5) * 0.14;
        treeBasePositions.push({ x: tx, y: ty, z: tz, scale: sc });

        _posVec.set(tx, ty, tz);
        _scaleVec.set(sc, sc, sc);
        _quat.identity();
        _mat4.compose(_posVec, _quat, _scaleVec);
        trunkInstanced.setMatrixAt(i, _mat4);
        treeInstancedMesh.setMatrixAt(i, _mat4);
        _color.setHSL(0.31 + (i % 3) * 0.02, 0.5, 0.38 + (i % 4) * 0.05);
        treeInstancedMesh.setColorAt(i, _color);
      }
      trunkInstanced.instanceMatrix.needsUpdate = true;
      treeInstancedMesh.instanceMatrix.needsUpdate = true;
      if (treeInstancedMesh.instanceColor) treeInstancedMesh.instanceColor.needsUpdate = true;
      worldGroup.add(trunkInstanced);
      worldGroup.add(treeInstancedMesh);

      // 6. Destructible Obstacles
      obstacleRigs = arena.obstacles.map((obs) => {
        const rig = createCompositeObstacle(obs, woodTex, stoneTex, isSoftwareGl);
        rig.group.visible = !obs.destroyed;
        worldGroup.add(rig.group);
        return rig;
      });

      // 7. Composite 12-Part 3D Archers
      const rig1 = createCompositeArcher(true, isSoftwareGl);
      const rig2 = createCompositeArcher(false, isSoftwareGl);
      worldGroup.add(rig1.root);
      worldGroup.add(rig2.root);
      archerRigs = [rig1, rig2];
      updateArcherPose(rig1, archers[0], true, 0, propsRef.current.windSpeed);
      updateArcherPose(rig2, archers[1], false, 0, propsRef.current.windSpeed);
    };

    buildArenaScene(propsRef.current.arena, propsRef.current.archers);
    rebuildSceneArenaRef.current = buildArenaScene;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

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
      const { archers } = propsRef.current;
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

      trailHistory.length = 0;
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        trailHistory.push({ x: origin.x, y: origin.y, z: 0 });
      }
      arrowTrailLine.visible = true;

      if (archerRigs) {
        archerRigs[trigger.shooterId - 1].nockedArrow.visible = false;
      }

      flyingArrow.visible = true;
      flyingArrow.position.set(origin.x, origin.y, 0);
      flyingArrow.rotation.z = activeFlight.angleRad;

      soundEngine.playBowRelease(trigger.powerPct);
      soundEngine.startArrowWhistle();
      spawnParticles(origin.x, origin.y, 0, 8, 0xfbbf24, 0.65);
    };

    // Drag-and-Release Aiming on Touch / Mouse Screen
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
      const span = Math.min(rect.width, rect.height, 360);
      const dx = (e.clientX - dragStartX) / Math.max(180, span);
      const dy = (e.clientY - dragStartY) / Math.max(180, span);

      const activeArcher = p.archers[p.currentTurn - 1];
      const pullDelta = -dx * activeArcher.facing * 95;
      const elevDelta = -dy * 95;

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
      if (distDragged > 38) {
        propsRef.current.onDragFire();
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // ResizeObserver with Portrait/Landscape adaptive FOV
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      const aspect = w / h;
      camera.aspect = aspect;
      // Wider vertical FOV in portrait mode so 3D depth and tall parabolic arcs fill the vertical screen
      camera.fov = aspect < 1 ? 58 : 42;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.render(scene, camera);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

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

      // Update Sky Dome Shader & Fog
      updateSkyWeather(currentProps.weather, elapsed);
      if (currentProps.weather === 'dust') {
        fogColor.setHex(0x452215);
        weatherMat.color.setHex(0xfde68a);
      } else if (currentProps.weather === 'rain') {
        fogColor.setHex(0x111a2e);
        weatherMat.color.setHex(0x93c5fd);
      } else {
        fogColor.setHex(0x1e2542);
        weatherMat.color.setHex(0xe2e8f0);
      }
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.copy(fogColor);
      }

      // Animate Fire Braziers flickering & War Banners waving with windSpeed
      for (let i = 0; i < brazierFlames.length; i++) {
        const fl = brazierFlames[i];
        const flicker = 0.88 + Math.sin(elapsed * 14 + i * 2) * 0.16;
        fl.scale.set(flicker, 0.9 + Math.cos(elapsed * 18 + i) * 0.22, flicker);
        fl.rotation.z = -currentProps.windSpeed * 0.04;
      }
      for (let i = 0; i < warBannerCloths.length; i++) {
        const cloth = warBannerCloths[i];
        const windDir = currentProps.windSpeed >= 0 ? 0 : Math.PI;
        cloth.rotation.y = windDir + Math.sin(elapsed * 5.5 + i) * (0.12 + Math.abs(currentProps.windSpeed) * 0.03);
      }

      // Drift Volumetric 3D Clouds with Wind
      for (const cl of cloudClusters) {
        cl.group.position.x += currentProps.windSpeed * cl.speedFactor * dt;
        if (cl.group.position.x > 52) cl.group.position.x = -52;
        if (cl.group.position.x < -52) cl.group.position.x = 52;
      }

      // Animate Trees swaying with windSpeed
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
        if (wp.y < -2) wp.y = 24;
        if (wp.y > 24) wp.y = -2;

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
          updateArcherPose(
            rig,
            arch,
            currentProps.currentTurn === arch.id,
            elapsed,
            currentProps.windSpeed
          );
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
        previewTipMesh.lookAt(camera.position);
      }

      // Sim-level Hitstop & Active Arrow Ballistics + Trail Ribbon
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

          // Update glowing flight trail history
          trailHistory.pop();
          trailHistory.unshift({ x: activeFlight.x, y: activeFlight.y, z: 0 });
          for (let i = 0; i < TRAIL_LENGTH; i++) {
            const tp = trailHistory[i];
            trailPositions[i * 3] = tp.x;
            trailPositions[i * 3 + 1] = tp.y;
            trailPositions[i * 3 + 2] = tp.z;
          }
          (arrowTrailLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

          if (hit.hitType !== 'none' || Math.abs(next.x) > currentProps.arena.distance * 1.25 || next.y < -18) {
            const finalHit: HitDetectionResult =
              hit.hitType !== 'none'
                ? hit
                : { hitType: 'terrain', impactPoint: { x: next.x, y: next.y } };

            activeFlight.resolvedResult = finalHit;
            activeFlight.postImpactTimer = 0.55;
            flyingArrow.position.set(finalHit.impactPoint.x, finalHit.impactPoint.y, 0);

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
            arrowTrailLine.visible = false;

            if (finalHit.hitType === 'archer' && finalHit.targetArcherId && archerRigs) {
              const targetRig = archerRigs[finalHit.targetArcherId - 1];
              const targetArch = currentProps.archers[finalHit.targetArcherId - 1];
              targetRig.flashTimer = 0.15;
              const isHead = finalHit.hitZone === 'head';
              const isLethal = targetArch.hp - (finalHit.damage || 0) <= 0;

              hitstopTimer = isHead || isLethal ? 0.08 : 0.045;
              cameraTrauma = isHead || isLethal ? 0.9 : 0.6;
              soundEngine.playImpactFlesh(isHead);

              spawnParticles(
                finalHit.impactPoint.x,
                finalHit.impactPoint.y,
                0,
                isHead ? 30 : 18,
                isHead ? 0xef4444 : 0xf97316,
                isHead ? 1.4 : 1.05
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
              hitstopTimer = willDestroy ? 0.055 : 0.025;
              cameraTrauma = willDestroy ? 0.55 : 0.3;

              if (obs?.kind === 'barrel') {
                soundEngine.playImpactWood(willDestroy);
                spawnParticles(finalHit.impactPoint.x, finalHit.impactPoint.y, 0, willDestroy ? 24 : 12, 0xb45309, 1.15);
              } else {
                soundEngine.playImpactStone(willDestroy);
                spawnParticles(finalHit.impactPoint.x, finalHit.impactPoint.y, 0, willDestroy ? 26 : 14, 0x94a3b8, 1.15);
              }
            } else {
              cameraTrauma = 0.2;
              soundEngine.playImpactDirt();
              spawnParticles(finalHit.impactPoint.x, finalHit.impactPoint.y, 0, 12, 0xd6a77a, 0.8);
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

      // PORTRAIT & LANDSCAPE ADAPTIVE 3D CAMERA CHOREOGRAPHY
      const dist = currentProps.arena.distance;
      const p1 = currentProps.archers[0];
      const p2 = currentProps.archers[1];
      const activeArcher = currentProps.archers[currentProps.currentTurn - 1];
      const opponentArcher = currentProps.archers[currentProps.currentTurn === 1 ? 1 : 0];
      const midY = (p1.y + p2.y) * 0.5 + 2.2;
      const isPortrait = camera.aspect < 1.0;

      if (currentProps.appState === 'title') {
        if (isPortrait) {
          const halfDist = dist * 0.5;
          const sway = Math.sin(elapsed * 0.35);
          _camTargetPos.set(-halfDist - 10.5 + sway * 1.5, midY + 4.8, 5.0 + Math.cos(elapsed * 0.25) * 0.8);
          _camLookTarget.set(-halfDist + 8.5, midY - 0.8, 0);
        } else {
          const panX = -6 + Math.sin(elapsed * 0.35) * 9;
          _camTargetPos.set(panX, midY + 2.5, 26);
          _camLookTarget.set(panX * 0.35, midY - 0.2, 0);
        }
      } else if (activeFlight && currentProps.cinematicFollow) {
        // Cinematic 3D Arrow Follow Camera (works in both Portrait & Landscape!)
        const arrowX = activeFlight.x;
        const arrowY = Math.max(midY - 1, activeFlight.y);
        const dirSign = activeFlight.shooterId === 1 ? 1 : -1;
        if (isPortrait) {
          // Over-the-shoulder 3D chase camera behind/beside the arrow for dramatic vertical screen depth
          _camTargetPos.set(arrowX - dirSign * 9.5, arrowY + 3.4, 4.8);
          _camLookTarget.set(arrowX + dirSign * 6.0, arrowY + 0.2, 0);
        } else {
          const zoomZ = activeFlight.resolvedResult ? 17 : 23;
          _camTargetPos.set(arrowX * 0.88, arrowY + 2.4, zoomZ);
          _camLookTarget.set(arrowX, arrowY + 0.4, 0);
        }
      } else if (isPortrait) {
        // VERTICAL PORTRAIT MODE CAMERA FRAMING
        const side = activeArcher.facing;
        if (currentProps.cameraMode === 'overview') {
          // Elevated 3D Diagonal Panorama fitting both archers across the vertical screen
          _camTargetPos.set(activeArcher.x - side * 15.5, activeArcher.y + 8.8, 4.2);
          _camLookTarget.set(activeArcher.x + side * 6.5, midY - 0.8, 0);
        } else if (currentProps.cameraMode === 'focus') {
          // Close-up Over-the-Shoulder 3D Aiming View
          _camTargetPos.set(activeArcher.x - side * 9.5, activeArcher.y + 4.8, 2.8);
          _camLookTarget.set(activeArcher.x + side * 5.0, activeArcher.y + 1.4, 0);
        } else {
          // 'auto' in Portrait: Over-the-shoulder 3/4 diagonal canyon perspective (z = 3.2)
          // Keeps the full foreground archer (lower-left), 4.2m trajectory line, obstacles,
          // and opponent archer (upper-right) inside the narrow 390x844 portrait frustum!
          _camTargetPos.set(activeArcher.x - side * 13.8, activeArcher.y + 7.2, 3.2);
          _camLookTarget.set(activeArcher.x + side * 5.8, midY - 0.8, 0);
        }
      } else {
        // LANDSCAPE / DESKTOP 2.5D SIDE-VIEW FRAMING
        if (currentProps.cameraMode === 'focus') {
          const focusX = activeArcher.x * 0.62;
          _camTargetPos.set(focusX, activeArcher.y + 4.2, 28);
          _camLookTarget.set(activeArcher.x * 0.25, midY, 0);
        } else if (currentProps.cameraMode === 'overview') {
          const requiredZ = Math.max(46, dist * 1.16);
          _camTargetPos.set(0, midY + 3.2, requiredZ);
          _camLookTarget.set(0, midY - 0.4, 0);
        } else {
          const biasX = activeArcher.x * 0.05;
          const requiredZ = Math.max(45, dist * 1.12);
          _camTargetPos.set(biasX, midY + 3.0, requiredZ);
          _camLookTarget.set(biasX * 0.3, midY - 0.3, 0);
        }
      }

      const dampFactor = 1 - Math.exp(-8.5 * dt);
      camera.position.lerp(_camTargetPos, dampFactor);
      currentCamLook.lerp(_camLookTarget, dampFactor);

      if (cameraTrauma > 0) {
        cameraTrauma = Math.max(0, cameraTrauma - dt * 1.8);
        const shake = cameraTrauma * cameraTrauma * 0.65;
        camera.position.x += Math.sin(elapsed * 55) * shake;
        camera.position.y += Math.cos(elapsed * 63) * shake;
      }

      camera.lookAt(currentCamLook);
      domeGroup.position.copy(camera.position);
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

  const prevSeedRef = useRef<number>(props.arena.seed);
  useEffect(() => {
    if (props.arena.seed !== prevSeedRef.current) {
      prevSeedRef.current = props.arena.seed;
      rebuildSceneArenaRef.current?.(props.arena, props.archers);
    }
  }, [props.arena, props.archers]);

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
