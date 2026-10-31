import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  TRAJECTORY_PREVIEW_MAX_METERS,
  computeShortTrajectoryPreview,
  evaluatePointCollision,
  getTankMuzzleOrigin,
  powerToMuzzleVelocity,
  stepProjectile,
  terrainHeightAt,
  terrainSlopeAt,
  type BattlefieldConfig,
  type CameraPreset,
  type HitDetectionResult,
  type TankCombatState,
} from './physics';
import {
  createBiomeSkyDome,
  createObstacleRig,
  createProceduralTexture,
  createShellMesh,
  createSupplyCrateMesh,
  createTankRig,
  stepFlyingTurret,
  triggerTankExplosion,
  updateTankPose,
  type CrateRig,
  type ObstacleRig,
  type TankRig,
} from './scene3d';
import { soundEngine } from './sound';

export interface ActiveShotTrigger {
  shotId: number;
  shooterId: 1 | 2;
  barrelAngleDeg: number;
  powerPct: number;
  turretYawRad: number;
}

interface ArenaCanvasProps {
  appState: 'garage' | 'shop' | 'playing' | 'paused' | 'gameover';
  arena: BattlefieldConfig;
  tanks: [TankCombatState, TankCombatState];
  currentTurn: 1 | 2;
  windSpeed: number;
  cameraPreset: CameraPreset;
  isAITurn: boolean;
  shotTrigger: ActiveShotTrigger | null;
  onAimChange: (angleDeg: number, powerPct: number) => void;
  onShotResolved: (result: HitDetectionResult, landingX: number) => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const r = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    return /SwiftShader|llvmpipe|Software|Microsoft Basic Render/i.test(r);
  } catch {
    return false;
  }
}

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
  const rebuildSceneArenaRef = useRef<
    ((arena: BattlefieldConfig, tanks: [TankCombatState, TankCombatState]) => void) | null
  >(null);
  const launchShellInternalRef = useRef<((trigger: ActiveShotTrigger) => void) | null>(null);

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
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initW = container.clientWidth || window.innerWidth;
    const initH = container.clientHeight || window.innerHeight;
    renderer.setSize(initW, initH);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x1e293b);
    scene.background = fogColor;
    scene.fog = new THREE.FogExp2(0x1e293b, 0.0048);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const { domeGroup, updateBiomeSky } = createBiomeSkyDome();
    scene.add(domeGroup);

    const initAspect = initW / initH;
    const camera = new THREE.PerspectiveCamera(initAspect < 1 ? 56 : 44, initAspect, 0.5, 380);
    camera.position.set(-34, 8.5, 14);
    const currentCamLook = new THREE.Vector3(0, 2.5, 0);
    camera.lookAt(currentCamLook);

    // 3-Point Battlefield Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x452719, 1.05);
    hemiLight.position.set(0, 65, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffe4b5, 2.5);
    keyLight.position.set(22, 48, 32);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 5;
      keyLight.shadow.camera.far = 160;
      const d = 46;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
    rimLight.position.set(-32, 24, -26);
    scene.add(rimLight);

    const concreteTex = createProceduralTexture(renderer, '#64748b', '#475569', 'concrete');
    const desertTex = createProceduralTexture(renderer, '#b4844e', '#855c31', 'terrain');
    desertTex.repeat.set(14, 8);
    const snowTex = createProceduralTexture(renderer, '#e2e8f0', '#94a3b8', 'terrain');
    snowTex.repeat.set(14, 8);
    const indTex = createProceduralTexture(renderer, '#475569', '#334155', 'terrain');
    indTex.repeat.set(14, 8);
    const volcTex = createProceduralTexture(renderer, '#292524', '#7c2d12', 'terrain');
    volcTex.repeat.set(14, 8);

    const arenaGroup = new THREE.Group();
    scene.add(arenaGroup);

    let tankRigs: [TankRig, TankRig] | null = null;
    let obstacleRigs: ObstacleRig[] = [];
    let crateRigs: CrateRig[] = [];
    let lastPosX: [number, number] = [0, 0];

    // Direct 3D Dashed Trajectory Line right next to the tank barrel (Strictly 3..5m)
    const MAX_PREVIEW_VERTS = 44;
    const previewPositions = new Float32Array(MAX_PREVIEW_VERTS * 3);
    const previewGeo = new THREE.BufferGeometry();
    previewGeo.setAttribute('position', new THREE.BufferAttribute(previewPositions, 3));
    const previewMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 0.36,
      gapSize: 0.2,
      linewidth: 2,
    });
    const previewLine = new THREE.Line(previewGeo, previewMat);
    scene.add(previewLine);

    // Glowing Aim Reticle Ring at the end of the 4.5m trajectory line
    const previewTipGeo = new THREE.RingGeometry(0.16, 0.3, 18);
    const previewTipMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
    });
    const previewTipMesh = new THREE.Mesh(previewTipGeo, previewTipMat);
    scene.add(previewTipMesh);

    // Active Flying Artillery Shell + Glowing Tracer Ribbon
    let flyingShell = createShellMesh(0xf59e0b);
    flyingShell.visible = false;
    scene.add(flyingShell);

    const TRAIL_LENGTH = 22;
    const trailPositions = new Float32Array(TRAIL_LENGTH * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.88,
    });
    const shellTrailLine = new THREE.Line(trailGeo, trailMat);
    shellTrailLine.visible = false;
    scene.add(shellTrailLine);
    const trailHistory: Array<{ x: number; y: number; z: number }> = [];

    // Expanding Explosion Shockwave Ring
    const shockwaveGeo = new THREE.RingGeometry(0.6, 1.1, 24);
    shockwaveGeo.rotateX(-Math.PI / 2);
    const shockwaveMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const shockwaveMesh = new THREE.Mesh(shockwaveGeo, shockwaveMat);
    scene.add(shockwaveMesh);
    let shockwaveTimer = 0;

    // Pooled Explosion & Smoke Particle Buffer
    const PARTICLE_COUNT = 90;
    const particleGeo = new THREE.DodecahedronGeometry(0.18, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.1,
      flatShading: true,
    });
    const particleInstanced = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
    particleInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
      colorHex: 0xf97316,
    }));
    let particleCursor = 0;

    const spawnParticles = (
      ox: number,
      oy: number,
      oz: number,
      count: number,
      colorHex: number,
      speedScale = 1.0,
      sizeScale = 1.0
    ) => {
      for (let i = 0; i < count; i++) {
        const p = particlePool[particleCursor];
        particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
        p.active = true;
        p.x = ox + (Math.random() - 0.5) * 0.5;
        p.y = oy + (Math.random() - 0.5) * 0.5;
        p.z = oz + (Math.random() - 0.5) * 0.5;
        const theta = Math.random() * Math.PI * 2;
        const speed = (2.2 + Math.random() * 6.5) * speedScale;
        p.vx = Math.cos(theta) * speed;
        p.vy = (2.0 + Math.random() * 6.5) * speedScale;
        p.vz = (Math.random() - 0.5) * 5.0 * speedScale;
        p.life = 0;
        p.maxLife = 0.45 + Math.random() * 0.55;
        p.size = (0.7 + Math.random() * 1.1) * sizeScale;
        p.colorHex = colorHex;
      }
    };

    const triggerShockwave = (x: number, y: number, z: number, colorHex = 0xf97316) => {
      shockwaveMesh.position.set(x, y + 0.15, z);
      shockwaveMesh.scale.set(0.5, 0.5, 0.5);
      shockwaveMat.color.setHex(colorHex);
      shockwaveMat.opacity = 0.9;
      shockwaveTimer = 0.45;
    };

    // Weather Particle System (Sandstorm, Snowfall, Rain, Volcanic Ash)
    const WEATHER_COUNT = 130;
    const weatherPositions = new Float32Array(WEATHER_COUNT * 6);
    for (let i = 0; i < WEATHER_COUNT; i++) {
      const wx = (Math.random() - 0.5) * 110;
      const wy = Math.random() * 28;
      const wz = (Math.random() - 0.5) * 32;
      const idx = i * 6;
      weatherPositions[idx] = wx;
      weatherPositions[idx + 1] = wy;
      weatherPositions[idx + 2] = wz;
      weatherPositions[idx + 3] = wx + 0.7;
      weatherPositions[idx + 4] = wy;
      weatherPositions[idx + 5] = wz;
    }
    const weatherGeo = new THREE.BufferGeometry();
    weatherGeo.setAttribute('position', new THREE.BufferAttribute(weatherPositions, 3));
    const weatherMat = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.45,
    });
    const weatherLines = new THREE.LineSegments(weatherGeo, weatherMat);
    scene.add(weatherLines);

    // Pre-allocated vectors & matrices for zero-GC render loop
    const _mat4 = new THREE.Matrix4();
    const _posVec = new THREE.Vector3();
    const _scaleVec = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _color = new THREE.Color();
    const _camTargetPos = new THREE.Vector3();
    const _camLookTarget = new THREE.Vector3();

    // Build / Rebuild 3D Battlefield Terrain, Distant Mountains, Obstacles, Crates, and Tanks
    const buildBattlefieldScene = (
      arena: BattlefieldConfig,
      tanks: [TankCombatState, TankCombatState]
    ) => {
      if (tankRigs) {
        for (const rig of tankRigs) {
          if (rig.flyingTurret) {
            scene.remove(rig.flyingTurret.mesh);
          }
        }
      }

      while (arenaGroup.children.length > 0) {
        const child = arenaGroup.children[0];
        arenaGroup.remove(child);
      }

      updateBiomeSky(arena.biome);
      const selectedTerrainTex =
        arena.biome === 'snow'
          ? snowTex
          : arena.biome === 'industrial' || arena.biome === 'night'
            ? indTex
            : arena.biome === 'volcanic'
              ? volcTex
              : desertTex;

      // 1. Sculpted 3D Battlefield Terrain Mesh (Width 220m, Depth 140m)
      const width = 220;
      const depth = 140;
      const segX = 120;
      const segZ = 36;
      const groundGeo = new THREE.PlaneGeometry(width, depth, segX, segZ);
      groundGeo.rotateX(-Math.PI / 2);

      const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const baseH = terrainHeightAt(vx, arena);

        let extraMountain = 0;
        if (vz < -10) {
          const backFactor = Math.min(1, (-10 - vz) / 48);
          const ridge =
            Math.abs(Math.sin(vx * 0.06 + arena.seed * 0.01) * Math.cos(vx * 0.035)) * 22 +
            Math.abs(Math.sin(vx * 0.14)) * 6;
          extraMountain = backFactor * backFactor * ridge;
        } else if (vz > 8) {
          const frontFactor = Math.min(1, (vz - 8) / 28);
          extraMountain = -frontFactor * 3.5;
        }

        posAttr.setY(i, baseH + extraMountain);
      }
      groundGeo.computeVertexNormals();

      const groundMat = new THREE.MeshStandardMaterial({
        map: selectedTerrainTex,
        roughness: arena.biome === 'snow' ? 0.65 : 0.85,
        metalness: 0.08,
        flatShading: true,
      });
      const groundMesh = new THREE.Mesh(groundGeo, groundMat);
      groundMesh.receiveShadow = true;
      arenaGroup.add(groundMesh);

      // 2. Distant Mountain Silhouettes & Radar Towers / Pine Trees
      const peakMat = new THREE.MeshStandardMaterial({
        color:
          arena.biome === 'snow'
            ? 0x94a3b8
            : arena.biome === 'volcanic'
              ? 0x292524
              : arena.biome === 'desert'
                ? 0x78350f
                : 0x1e293b,
        roughness: 0.9,
        flatShading: true,
      });
      for (let i = -4; i <= 4; i++) {
        const px = i * 24 + ((arena.seed + i * 19) % 9);
        const ph = 18 + Math.abs((i * 11 + arena.seed) % 16);
        const peak = new THREE.Mesh(new THREE.ConeGeometry(14 + (i % 3) * 3, ph, 6), peakMat);
        peak.position.set(px, ph * 0.42 - 2, -42 - Math.abs(i) * 3);
        arenaGroup.add(peak);
      }

      // 3. Destructible Obstacles
      obstacleRigs = [];
      for (const obs of arena.obstacles) {
        if (obs.destroyed) continue;
        const oRig = createObstacleRig(obs, concreteTex);
        arenaGroup.add(oRig.group);
        obstacleRigs.push(oRig);
      }

      // 4. Supply Crates (First-Aid Heal & Gold Coin Crates)
      crateRigs = [];
      for (const crate of arena.crates) {
        if (crate.collected) continue;
        const cRig = createSupplyCrateMesh(crate);
        arenaGroup.add(cRig.group);
        crateRigs.push(cRig);
      }

      // 5. Build Both 3D Tank Rigs
      const rig1 = createTankRig(tanks[0].model, 1, renderer);
      rig1.root.position.set(tanks[0].x, tanks[0].y, tanks[0].z);
      arenaGroup.add(rig1.root);

      const rig2 = createTankRig(tanks[1].model, -1, renderer);
      rig2.root.position.set(tanks[1].x, tanks[1].y, tanks[1].z);
      arenaGroup.add(rig2.root);

      tankRigs = [rig1, rig2];
      lastPosX = [tanks[0].x, tanks[1].x];
    };

    rebuildSceneArenaRef.current = buildBattlefieldScene;
    buildBattlefieldScene(propsRef.current.arena, propsRef.current.tanks);

    // Active Shell Flight State
    let activeFlight: {
      shooterId: 1 | 2;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      t: number;
      postImpactTimer: number;
      resolvedResult: HitDetectionResult | null;
    } | null = null;

    let hitstopTimer = 0;
    let cameraTrauma = 0;

    launchShellInternalRef.current = (trigger: ActiveShotTrigger) => {
      const p = propsRef.current;
      const shooter = p.tanks[trigger.shooterId - 1];
      const tempShooter: TankCombatState = {
        ...shooter,
        barrelAngleDeg: trigger.barrelAngleDeg,
        powerPct: trigger.powerPct,
        turretYawRad: trigger.turretYawRad,
      };
      const origin = getTankMuzzleOrigin(tempShooter);
      const speed = powerToMuzzleVelocity(trigger.powerPct, shooter.shell.muzzleVelocityMultiplier);
      const angleRad = (trigger.barrelAngleDeg * Math.PI) / 180;
      const dir = shooter.facing;

      activeFlight = {
        shooterId: trigger.shooterId,
        x: origin.x,
        y: origin.y,
        z: origin.z,
        vx: dir * speed * Math.cos(angleRad) * Math.cos(trigger.turretYawRad),
        vy: speed * Math.sin(angleRad),
        vz: speed * Math.cos(angleRad) * Math.sin(trigger.turretYawRad),
        t: 0,
        postImpactTimer: 0,
        resolvedResult: null,
      };

      // Update shell & tracer color to match the equipped shell type
      scene.remove(flyingShell);
      flyingShell = createShellMesh(shooter.shell.colorHex);
      flyingShell.visible = true;
      flyingShell.position.set(origin.x, origin.y, origin.z);
      scene.add(flyingShell);

      trailMat.color.setHex(shooter.shell.colorHex);
      trailHistory.length = 0;
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        trailHistory.push({ x: origin.x, y: origin.y, z: origin.z });
      }
      shellTrailLine.visible = true;

      // Trigger barrel recoil, muzzle flash, cannon blast audio, and muzzle smoke
      if (tankRigs) {
        const sRig = tankRigs[trigger.shooterId - 1];
        sRig.recoilOffset = 0.42;
        const flashMat = sRig.muzzleFlashMesh.material as THREE.MeshBasicMaterial;
        flashMat.opacity = 1.0;
      }

      cameraTrauma = 0.32;
      soundEngine.playCannonBlast(shooter.model.barrelCount);
      soundEngine.startShellWhistle();
      spawnParticles(origin.x, origin.y, origin.z, 14, shooter.shell.colorHex, 0.9, 1.1);
    };

    // Direct Touch / Mouse Drag on 3D Canvas to Aim Tank Barrel (No Cluttered UI Sliders!)
    let isDraggingAim = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartAngle = 38;
    let dragStartPower = 72;

    const onPointerDown = (e: PointerEvent) => {
      const p = propsRef.current;
      if (p.appState !== 'playing' || p.isAITurn || activeFlight) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      isDraggingAim = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const activeTank = p.tanks[p.currentTurn - 1];
      dragStartAngle = activeTank.barrelAngleDeg;
      dragStartPower = activeTank.powerPct;
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
      const span = Math.min(rect.width, rect.height, 340);
      const dx = (e.clientX - dragStartX) / Math.max(170, span);
      const dy = (e.clientY - dragStartY) / Math.max(170, span);

      const activeTank = p.tanks[p.currentTurn - 1];
      const pullDelta = -dx * activeTank.facing * 85;
      const elevDelta = -dy * 85;

      const newAngle = Math.round(Math.max(5, Math.min(75, dragStartAngle + elevDelta)));
      const newPower = Math.round(Math.max(20, Math.min(100, dragStartPower + pullDelta)));

      soundEngine.playTurretServo(newPower);
      p.onAimChange(newAngle, newPower);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDraggingAim) return;
      isDraggingAim = false;
      renderer.domElement.releasePointerCapture?.(e.pointerId);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      const aspect = w / h;
      camera.aspect = aspect;
      camera.fov = aspect < 1 ? 56 : 44;
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
      function poll() {
        if (isUnmounted) return;
        const s = gl.clientWaitSync(sync!, 0, 0);
        if (s === gl.TIMEOUT_EXPIRED) {
          frameId = window.setTimeout(poll, 4);
          return;
        }
        gl.deleteSync(sync);
        cb();
      }
      frameId = window.setTimeout(poll, 4);
    }

    const tick = () => {
      if (isUnmounted) return;
      const nowMs = performance.now();
      const rawDt = (nowMs - lastFrameMs) / 1000;
      lastFrameMs = nowMs;
      const dt = Math.min(rawDt, 0.05);
      const elapsed = (nowMs - startTimeMs) / 1000;

      const currentProps = propsRef.current;

      if (hitstopTimer > 0) {
        hitstopTimer -= dt;
      }

      // 1. Update Tank Positions, Wheel Rotation, Slope Tilt, and Turret Blow-Off Physics
      if (tankRigs) {
        for (let i = 0; i < 2; i++) {
          const tState = currentProps.tanks[i];
          const rig = tankRigs[i];

          // Smoothly interpolate tank hull position when driving
          rig.root.position.x = THREE.MathUtils.lerp(rig.root.position.x, tState.x, 1 - Math.exp(-12 * dt));
          rig.root.position.y = THREE.MathUtils.lerp(rig.root.position.y, tState.y, 1 - Math.exp(-12 * dt));
          rig.root.position.z = THREE.MathUtils.lerp(rig.root.position.z, tState.z, 1 - Math.exp(-12 * dt));

          const deltaX = rig.root.position.x - lastPosX[i];
          lastPosX[i] = rig.root.position.x;
          if (Math.abs(deltaX) > 0.0005) {
            for (const wheel of rig.wheels) {
              wheel.rotation.z -= deltaX * 2.8;
            }
          }

          const slopeRad = terrainSlopeAt(rig.root.position.x, currentProps.arena);
          updateTankPose(rig, tState.facing, tState.barrelAngleDeg, tState.turretYawRad, slopeRad, dt);

          if (rig.turretBlownOff) {
            stepFlyingTurret(rig, dt, (x) => terrainHeightAt(x, currentProps.arena));
            // Emit continuous dark smoke & embers from the destroyed hull ring
            if (Math.random() < 0.35) {
              spawnParticles(rig.root.position.x, rig.root.position.y + 1.1, rig.root.position.z, 1, 0x27272a, 0.45, 1.3);
            }
          }
        }
      }

      // 2. Sync Obstacles & Supply Crates visibility (hide in Garage/Shop so the 3D Tank showcase is 100% unobstructed!)
      const inBattle =
        currentProps.appState === 'playing' ||
        currentProps.appState === 'paused' ||
        currentProps.appState === 'gameover';

      for (const oRig of obstacleRigs) {
        const obsState = currentProps.arena.obstacles.find((o) => o.id === oRig.id);
        oRig.group.visible = inBattle && Boolean(obsState && !obsState.destroyed);
      }

      for (const cRig of crateRigs) {
        const cState = currentProps.arena.crates.find((c) => c.id === cRig.id);
        cRig.group.visible = inBattle && Boolean(cState && !cState.collected);
        if (cRig.group.visible) {
          cRig.group.rotation.y = elapsed * 1.4;
          cRig.group.position.y = (cState?.y ?? 0) + 0.58 + Math.sin(elapsed * 2.8) * 0.12;
        }
      }

      // 3. Update Direct 3D Dashed Trajectory Line right next to the Tank Barrel
      const activeTank = currentProps.tanks[currentProps.currentTurn - 1];
      const showPreview =
        currentProps.appState === 'playing' &&
        !activeFlight &&
        activeTank.hp > 0 &&
        !currentProps.isAITurn;

      previewLine.visible = showPreview;
      previewTipMesh.visible = showPreview;

      if (showPreview) {
        previewMat.color.setHex(activeTank.shell.colorHex);
        previewTipMat.color.setHex(activeTank.shell.colorHex);

        const pts = computeShortTrajectoryPreview(
          activeTank,
          currentProps.windSpeed,
          TRAJECTORY_PREVIEW_MAX_METERS
        );
        const posArr = previewGeo.attributes.position as THREE.BufferAttribute;
        const count = Math.min(pts.length, MAX_PREVIEW_VERTS);

        for (let i = 0; i < count; i++) {
          posArr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
        }
        const lastPt = pts[count - 1] || { x: activeTank.x, y: activeTank.y, z: activeTank.z };
        for (let i = count; i < MAX_PREVIEW_VERTS; i++) {
          posArr.setXYZ(i, lastPt.x, lastPt.y, lastPt.z);
        }
        posArr.needsUpdate = true;
        previewGeo.setDrawRange(0, count);
        previewLine.computeLineDistances();

        previewTipMesh.position.set(lastPt.x, lastPt.y, lastPt.z);
        previewTipMesh.lookAt(camera.position);
      }

      // 4. Step Active Flying Artillery Shell
      if (activeFlight && hitstopTimer <= 0) {
        if (!activeFlight.resolvedResult) {
          const subSteps = 3;
          const subDt = dt / subSteps;
          let hitResult: HitDetectionResult | null = null;

          for (let s = 0; s < subSteps; s++) {
            const nextState = stepProjectile(
              {
                x: activeFlight.x,
                y: activeFlight.y,
                z: activeFlight.z,
                vx: activeFlight.vx,
                vy: activeFlight.vy,
                vz: activeFlight.vz,
                t: activeFlight.t,
              },
              subDt,
              currentProps.windSpeed
            );

            const check = evaluatePointCollision(
              nextState.x,
              nextState.y,
              nextState.z,
              activeFlight.shooterId,
              currentProps.tanks,
              currentProps.arena,
              nextState.t
            );

            activeFlight.x = nextState.x;
            activeFlight.y = nextState.y;
            activeFlight.z = nextState.z;
            activeFlight.vx = nextState.vx;
            activeFlight.vy = nextState.vy;
            activeFlight.vz = nextState.vz;
            activeFlight.t = nextState.t;

            if (check.hitType !== 'none') {
              activeFlight.x = check.impactPoint.x;
              activeFlight.y = check.impactPoint.y;
              activeFlight.z = check.impactPoint.z;
              hitResult = check;
              break;
            }

            if (Math.abs(activeFlight.x) > currentProps.arena.distance * 1.35 || activeFlight.y < -25) {
              hitResult = {
                hitType: 'ground',
                impactPoint: {
                  x: activeFlight.x,
                  y: terrainHeightAt(activeFlight.x, currentProps.arena),
                  z: activeFlight.z,
                },
              };
              break;
            }
          }

          // Orient shell along velocity vector
          flyingShell.position.set(activeFlight.x, activeFlight.y, activeFlight.z);
          const pitchAngle = Math.atan2(activeFlight.vy, activeFlight.vx);
          flyingShell.rotation.z = pitchAngle;

          // Update tracer ribbon
          trailHistory.unshift({ x: activeFlight.x, y: activeFlight.y, z: activeFlight.z });
          if (trailHistory.length > TRAIL_LENGTH) trailHistory.pop();
          const tPos = trailGeo.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < TRAIL_LENGTH; i++) {
            const pt = trailHistory[Math.min(i, trailHistory.length - 1)];
            tPos.setXYZ(i, pt.x, pt.y, pt.z);
          }
          tPos.needsUpdate = true;

          soundEngine.updateShellWhistle(Math.hypot(activeFlight.vx, activeFlight.vy), activeFlight.vy);

          if (hitResult) {
            soundEngine.stopShellWhistle();
            activeFlight.resolvedResult = hitResult;
            activeFlight.postImpactTimer = 0.52;
            flyingShell.visible = false;
            shellTrailLine.visible = false;

            const ix = hitResult.impactPoint.x;
            const iy = hitResult.impactPoint.y;
            const iz = hitResult.impactPoint.z;

            if (hitResult.hitType === 'tank' && hitResult.targetTankId && tankRigs) {
              const targetIdx = hitResult.targetTankId - 1;
              const targetState = currentProps.tanks[targetIdx];
              const targetRig = tankRigs[targetIdx];
              const dmg = hitResult.damage || 28;
              const isLethal = targetState.hp - dmg <= 0;
              const isTurret = hitResult.hitZone === 'turret';

              hitstopTimer = isLethal ? 0.1 : isTurret ? 0.065 : 0.035;
              cameraTrauma = isLethal ? 1.0 : isTurret ? 0.72 : 0.45;

              triggerShockwave(ix, iy, iz, isLethal ? 0xef4444 : 0xf97316);
              spawnParticles(ix, iy, iz, isLethal ? 42 : 24, isTurret ? 0xef4444 : 0xf97316, isLethal ? 1.65 : 1.15, 1.3);
              spawnParticles(ix, iy + 0.4, iz, isLethal ? 24 : 10, 0x27272a, 0.85, 1.5);

              if (isLethal) {
                soundEngine.playTankExplosion();
                triggerTankExplosion(targetRig, scene);
              } else {
                soundEngine.playImpactArmor(isTurret);
              }
            } else if (hitResult.hitType === 'crate') {
              cameraTrauma = 0.25;
              soundEngine.playCratePickup();
              triggerShockwave(ix, iy, iz, 0x10b981);
              spawnParticles(ix, iy, iz, 20, 0xfbbf24, 1.1, 1.0);
            } else if (hitResult.hitType === 'obstacle') {
              cameraTrauma = 0.48;
              soundEngine.playImpactArmor(false);
              triggerShockwave(ix, iy, iz, 0xf59e0b);
              spawnParticles(ix, iy, iz, 26, 0x94a3b8, 1.25, 1.2);
            } else {
              cameraTrauma = 0.28;
              soundEngine.playImpactGround();
              triggerShockwave(ix, iy, iz, 0xd97706);
              spawnParticles(ix, iy, iz, 16, 0xb4844e, 0.9, 1.0);
            }
          }
        } else {
          activeFlight.postImpactTimer -= dt;
          if (activeFlight.postImpactTimer <= 0) {
            const res = activeFlight.resolvedResult;
            const landX = res.impactPoint.x;
            activeFlight = null;
            currentProps.onShotResolved(res, landX);
          }
        }
      }

      // 5. Step Shockwave Ring & Pooled Particles
      if (shockwaveTimer > 0) {
        shockwaveTimer = Math.max(0, shockwaveTimer - dt);
        const progress = 1 - shockwaveTimer / 0.45;
        const s = 0.6 + progress * 6.5;
        shockwaveMesh.scale.set(s, s, s);
        shockwaveMat.opacity = Math.max(0, (1 - progress) * 0.85);
      }

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

      // 6. Step Biome Weather Particles
      const wAttr = weatherGeo.attributes.position as THREE.BufferAttribute;
      const windVx = currentProps.windSpeed * 2.1;
      const fallVy = currentProps.arena.biome === 'industrial' ? -13.0 : -4.2;

      for (let i = 0; i < WEATHER_COUNT; i++) {
        const idx = i * 2;
        let x = wAttr.getX(idx) + windVx * dt;
        let y = wAttr.getY(idx) + fallVy * dt;
        const z = wAttr.getZ(idx);

        if (x > 60) x = -60;
        if (x < -60) x = 60;
        if (y < -2) y = 26;

        const streakX = windVx * 0.045;
        const streakY = fallVy * 0.045;
        wAttr.setXYZ(idx, x, y, z);
        wAttr.setXYZ(idx + 1, x + streakX, y + streakY, z);
      }
      wAttr.needsUpdate = true;

      // 7. 5-Angle Camera Choreography (Supports Garage Orbit + 5 Battle Camera Presets in Portrait & Landscape!)
      const p1 = currentProps.tanks[0];
      const p2 = currentProps.tanks[1];
      const curTank = currentProps.tanks[currentProps.currentTurn - 1];
      const oppTank = currentProps.tanks[currentProps.currentTurn === 1 ? 1 : 0];
      const midY = (p1.y + p2.y) * 0.5 + 1.8;
      const isPortrait = camera.aspect < 1.0;

      if (currentProps.appState === 'garage' || currentProps.appState === 'shop') {
        // 3D Garage Showcase Camera orbiting the front hemisphere of the Player's Tank
        // Offset lookAt downward so the 3D Tank projects into the open upper-middle viewport above the Garage panel!
        const swayAngle = 0.58 + Math.sin(elapsed * 0.55) * 0.45;
        const radius = isPortrait ? 6.8 : 5.8;
        _camTargetPos.set(
          p1.x + Math.cos(swayAngle) * radius,
          p1.y + (isPortrait ? 1.85 : 2.1),
          p1.z + Math.sin(swayAngle) * radius
        );
        _camLookTarget.set(p1.x + 0.2, p1.y - (isPortrait ? 1.35 : 0.15), p1.z);
        camera.position.copy(_camTargetPos);
        currentCamLook.copy(_camLookTarget);
      } else if (activeFlight && currentProps.cameraPreset === 'cinematic') {
        // Preset 5: Shell Follow Cinematic Camera
        const dirSign = activeFlight.shooterId === 1 ? 1 : -1;
        if (isPortrait) {
          _camTargetPos.set(activeFlight.x - dirSign * 10.5, Math.max(3.5, activeFlight.y + 3.6), activeFlight.z + 5.2);
          _camLookTarget.set(activeFlight.x + dirSign * 6.0, Math.max(1.2, activeFlight.y + 0.2), activeFlight.z);
        } else {
          _camTargetPos.set(activeFlight.x * 0.88, Math.max(3.2, activeFlight.y + 2.8), 22);
          _camLookTarget.set(activeFlight.x, Math.max(1.2, activeFlight.y + 0.3), activeFlight.z);
        }
      } else if (currentProps.cameraPreset === 'turret') {
        // Preset 1: Behind-the-Turret 3D Aiming View
        const side = curTank.facing;
        _camTargetPos.set(
          curTank.x - side * (isPortrait ? 9.5 : 8.2),
          curTank.y + (isPortrait ? 4.4 : 3.6),
          curTank.z + (isPortrait ? 2.4 : 2.0)
        );
        _camLookTarget.set(
          curTank.x + side * 14.0,
          curTank.y + 2.2,
          oppTank.z * 0.5
        );
      } else if (currentProps.cameraPreset === 'drone') {
        // Preset 4: Top-Down Strategic Drone View
        const dist = currentProps.arena.distance;
        _camTargetPos.set(0, midY + (isPortrait ? dist * 1.15 : dist * 0.78), isPortrait ? 18 : 24);
        _camLookTarget.set(0, midY - 1.0, 0);
      } else if (currentProps.cameraPreset === 'side') {
        // Preset 3: Wide Side Artillery View
        const dist = currentProps.arena.distance;
        if (isPortrait) {
          const side = curTank.facing;
          _camTargetPos.set(curTank.x - side * 16.5, curTank.y + 9.2, 4.8);
          _camLookTarget.set(curTank.x + side * 7.5, midY - 0.8, 0);
        } else {
          _camTargetPos.set(0, midY + 4.2, Math.max(52, dist * 1.08));
          _camLookTarget.set(0, midY - 0.2, 0);
        }
      } else {
        // Preset 2 ('tactical' / 'cinematic' while aiming): 3/4 Tactical Diagonal View
        const side = curTank.facing;
        if (isPortrait) {
          _camTargetPos.set(curTank.x - side * 14.2, curTank.y + 7.4, curTank.z + 3.4);
          _camLookTarget.set(curTank.x + side * 6.2, midY - 0.8, oppTank.z * 0.4);
        } else {
          const dist = currentProps.arena.distance;
          _camTargetPos.set(curTank.x * 0.35 - side * 8.0, midY + 5.8, Math.max(42, dist * 0.78));
          _camLookTarget.set(0, midY - 0.2, 0);
        }
      }

      const damp = 1 - Math.exp(-8.5 * dt);
      camera.position.lerp(_camTargetPos, damp);
      currentCamLook.lerp(_camLookTarget, damp);

      if (cameraTrauma > 0) {
        cameraTrauma = Math.max(0, cameraTrauma - dt * 1.7);
        const shake = cameraTrauma * cameraTrauma * 0.65;
        camera.position.x += Math.sin(elapsed * 52) * shake;
        camera.position.y += Math.cos(elapsed * 46) * shake;
      }

      camera.lookAt(currentCamLook);
      renderer.render(scene, camera);
      afterDraw(tick);
    };

    frameId = window.setTimeout(tick, 0);

    return () => {
      isUnmounted = true;
      window.clearTimeout(frameId);
      soundEngine.stopShellWhistle();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Rebuild 3D battlefield whenever arena seed/stage or selected tank model changes
  useEffect(() => {
    if (rebuildSceneArenaRef.current) {
      rebuildSceneArenaRef.current(props.arena, props.tanks);
    }
  }, [props.arena, props.tanks[0].model.id, props.tanks[1].model.id]);

  // Trigger shell launch when shotTrigger increments
  useEffect(() => {
    if (props.shotTrigger && props.shotTrigger.shotId !== lastShotIdRef.current) {
      lastShotIdRef.current = props.shotTrigger.shotId;
      launchShellInternalRef.current?.(props.shotTrigger);
    }
  }, [props.shotTrigger]);

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 w-screen h-screen overflow-hidden cursor-crosshair touch-none"
      aria-label="میدان نبرد سه‌بعدی جنگ تانک‌ها"
    />
  );
};
