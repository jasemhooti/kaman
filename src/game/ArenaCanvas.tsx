import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  TRAJECTORY_PREVIEW_MAX_METERS,
  computeShortTrajectoryPreview,
  evaluatePointCollision,
  getTankMuzzleOrigin,
  getTankWorldAimYaw,
  powerToMuzzleVelocity,
  stepProjectile,
  terrainHeightAt,
  type BattlefieldConfig,
  type CameraPreset,
  type HitDetectionResult,
  type TankCombatState,
} from './physics';
import {
  createCraterDecalMesh,
  createObstacleRig,
  createOpenWorldScenery,
  createPbrTextureSet,
  createShellMesh,
  createSupplyCrateMesh,
  createTankRig,
  getBiomePalette,
  stepFlyingTurret,
  triggerTankExplosion,
  updateTankPose,
  type CrateRig,
  type ObstacleRig,
  type PbrTextureSet,
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
  driveInput?: { throttle: number; steer: number };
  onAimChange: (barrelAngleDeg: number, powerPct: number, deltaTurretYawRad?: number) => void;
  onContinuousDrive?: (throttle: number, steer: number, dt: number) => void;
  onShotResolved: (result: HitDetectionResult, landingX: number) => void;
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

const PARTICLE_COUNT = 220;
const WEATHER_COUNT = 160;
const _mat4 = new THREE.Matrix4();
const _posVec = new THREE.Vector3();
const _scaleVec = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _color = new THREE.Color();
const _camTargetPos = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();

export const ArenaCanvas: React.FC<ArenaCanvasProps> = (props) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef<ArenaCanvasProps>(props);
  propsRef.current = props;

  const rebuildSceneArenaRef = useRef<((arena: BattlefieldConfig) => void) | null>(null);
  const fireProjectileRef = useRef<((trigger: ActiveShotTrigger) => void) | null>(null);
  const lastFiredShotIdRef = useRef<number>(0);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initialW = container.clientWidth || window.innerWidth;
    const initialH = container.clientHeight || window.innerHeight;
    renderer.setSize(initialW, initialH);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 4);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xeab376, 0.0042);

    // Mandatory Studio PBR Environment Map (RoomEnvironment + PMREMGenerator) so metallic armor reflects realistically!
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const initialAspect = initialW / initialH;
    const camera = new THREE.PerspectiveCamera(
      initialAspect < 1 ? 58 : 46,
      initialAspect,
      0.5,
      1100
    );
    camera.position.set(-38, 12, 26);
    const currentCamLook = new THREE.Vector3(0, 2.5, 0);
    camera.lookAt(currentCamLook);

    // 1. Physical Atmospheric Scattering Sky Dome (Three.js Sky Shader)
    const sky = new Sky();
    sky.scale.setScalar(950);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.82;

    // 2. Three-Point Outdoor & Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xfffbeb, 0x475569, 1.05);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff7ed, 2.6);
    sunLight.position.set(48, 64, 38);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.near = 5;
    sunLight.shadow.camera.far = 240;
    const d = 88;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.72);
    rimLight.position.set(-55, 28, -42);
    scene.add(rimLight);

    // 3. Soft 3D Volumetric Cloud Ring on the Horizon
    const cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.78,
    });
    const puffGeo = new THREE.DodecahedronGeometry(6.5, 1);
    for (let c = 0; c < 18; c++) {
      const cAngle = (c / 18) * Math.PI * 2;
      const cDist = 145 + (c % 3) * 22;
      const cluster = new THREE.Group();
      cluster.position.set(
        Math.cos(cAngle) * cDist,
        36 + (c % 4) * 6,
        Math.sin(cAngle) * cDist
      );
      cluster.rotation.y = -cAngle;
      for (let p = -1; p <= 1; p++) {
        const puff = new THREE.Mesh(puffGeo, cloudMat);
        puff.position.set(p * 5.2, Math.abs(p) * -1.2, (p % 2) * 2.0);
        puff.scale.set(1.6, 0.52, 1.1);
        cluster.add(puff);
      }
      cloudGroup.add(cluster);
    }
    scene.add(cloudGroup);

    // 4. Shared PBR Texture Sets for Concrete & Open-World Biomes
    const concretePbrMaps = createPbrTextureSet('concrete', 3, 3, maxAnisotropy);
    const biomeTextureCache = new Map<string, PbrTextureSet>();
    const getBiomeMaps = (biome: BattlefieldConfig['biome']): PbrTextureSet => {
      let cached = biomeTextureCache.get(biome);
      if (!cached) {
        cached = createPbrTextureSet(biome, 28, 28, maxAnisotropy);
        biomeTextureCache.set(biome, cached);
      }
      return cached;
    };

    // 5. High-Resolution 260m x 260m 3D Open-World Terrain Mesh
    const groundGeo = new THREE.PlaneGeometry(260, 260, 150, 150);
    groundGeo.rotateX(-Math.PI / 2);
    const vertexCount = groundGeo.attributes.position.count;
    groundGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3)
    );

    const initialBiomeMaps = getBiomeMaps(propsRef.current.arena.biome);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: initialBiomeMaps.map,
      normalMap: initialBiomeMaps.normalMap,
      normalScale: new THREE.Vector2(1.45, 1.45),
      roughnessMap: initialBiomeMaps.roughnessMap,
      roughness: 0.86,
      metalness: 0.06,
      flatShading: false,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    const obstacleGroup = new THREE.Group();
    scene.add(obstacleGroup);
    let obstacleRigs: ObstacleRig[] = [];

    const crateGroup = new THREE.Group();
    scene.add(crateGroup);
    let crateRigs: CrateRig[] = [];

    const craterGroup = new THREE.Group();
    scene.add(craterGroup);

    const openWorldSceneryHolder = new THREE.Group();
    scene.add(openWorldSceneryHolder);

    // 6. Both Tanks (Player 1 & Enemy Tank)
    const tanksHolder = new THREE.Group();
    scene.add(tanksHolder);
    let tankRigs: [TankRig, TankRig] | null = null;
    let currentTankModelIds: [string, string] = ['', ''];

    const ensureTankRigs = (t1: TankCombatState, t2: TankCombatState) => {
      if (
        !tankRigs ||
        currentTankModelIds[0] !== t1.model.id ||
        currentTankModelIds[1] !== t2.model.id
      ) {
        if (tankRigs) {
          tanksHolder.remove(tankRigs[0].root);
          tanksHolder.remove(tankRigs[1].root);
          if (tankRigs[0].flyingTurret) scene.remove(tankRigs[0].flyingTurret.mesh);
          if (tankRigs[1].flyingTurret) scene.remove(tankRigs[1].flyingTurret.mesh);
        }
        const rig1 = createTankRig(t1.model, 1, maxAnisotropy);
        const rig2 = createTankRig(t2.model, -1, maxAnisotropy);
        tanksHolder.add(rig1.root);
        tanksHolder.add(rig2.root);
        tankRigs = [rig1, rig2];
        currentTankModelIds = [t1.model.id, t2.model.id];
      }
    };

    ensureTankRigs(propsRef.current.tanks[0], propsRef.current.tanks[1]);

    // 7. Short Dashed Trajectory Preview Line (3-5m right next to the tank barrel)
    const maxPreviewPts = 42;
    const previewPositions = new Float32Array(maxPreviewPts * 3);
    const previewGeo = new THREE.BufferGeometry();
    previewGeo.setAttribute('position', new THREE.BufferAttribute(previewPositions, 3));
    const previewMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 0.35,
      gapSize: 0.2,
      transparent: true,
      opacity: 0.95,
    });
    const previewLine = new THREE.Line(previewGeo, previewMat);
    scene.add(previewLine);

    const reticleGeo = new THREE.RingGeometry(0.18, 0.3, 24);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    scene.add(reticleMesh);

    // 8. Active Flying Shell + Smoke Trail
    let activeShellGroup = createShellMesh(0xf59e0b);
    activeShellGroup.visible = false;
    scene.add(activeShellGroup);

    const maxTrailPts = 90;
    const trailPositions = new Float32Array(maxTrailPts * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.8,
    });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    scene.add(trailLine);

    // 9. Shockwave Ring & Pooled Particle System (Explosions, Track Dust, Exhaust Smoke)
    const shockwaveGeo = new THREE.RingGeometry(0.25, 0.58, 32);
    shockwaveGeo.rotateX(-Math.PI / 2);
    const shockwaveMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    const shockwaveMesh = new THREE.Mesh(shockwaveGeo, shockwaveMat);
    scene.add(shockwaveMesh);
    let shockwaveTimer = 0;

    const particleGeo = new THREE.DodecahedronGeometry(0.2, 0);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const particleInstanced = new THREE.InstancedMesh(
      particleGeo,
      particleMat,
      PARTICLE_COUNT
    );
    particleInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
      colorHex: 0xf59e0b,
    }));
    let particleCursor = 0;

    const spawnBurst = (
      x: number,
      y: number,
      z: number,
      count: number,
      colors: number[],
      speedScale = 1
    ) => {
      for (let i = 0; i < count; i++) {
        const p = particlePool[particleCursor];
        particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.65;
        const spd = (2.0 + Math.random() * 7.8) * speedScale;
        p.active = true;
        p.x = x + (Math.random() - 0.5) * 0.4;
        p.y = y + (Math.random() - 0.5) * 0.4;
        p.z = z + (Math.random() - 0.5) * 0.4;
        p.vx = Math.cos(theta) * Math.sin(phi) * spd;
        p.vy = Math.cos(phi) * spd + 1.8;
        p.vz = Math.sin(theta) * Math.sin(phi) * spd;
        p.life = 0;
        p.maxLife = 0.35 + Math.random() * 0.55;
        p.size = 0.65 + Math.random() * 1.3;
        p.colorHex = colors[i % colors.length];
      }
    };

    // 10. Dynamic Biome Weather Streaks
    const weatherPositions = new Float32Array(WEATHER_COUNT * 2 * 3);
    for (let i = 0; i < WEATHER_COUNT; i++) {
      const wx = (Math.random() - 0.5) * 160;
      const wy = Math.random() * 34;
      const wz = (Math.random() - 0.5) * 160;
      const idx = i * 6;
      weatherPositions[idx] = wx;
      weatherPositions[idx + 1] = wy;
      weatherPositions[idx + 2] = wz;
      weatherPositions[idx + 3] = wx + 0.5;
      weatherPositions[idx + 4] = wy - 0.3;
      weatherPositions[idx + 5] = wz;
    }
    const weatherGeo = new THREE.BufferGeometry();
    weatherGeo.setAttribute('position', new THREE.BufferAttribute(weatherPositions, 3));
    const weatherMat = new THREE.LineBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.36,
    });
    const weatherLines = new THREE.LineSegments(weatherGeo, weatherMat);
    scene.add(weatherLines);

    // 11. Carve a Real 3D Crater into the Open-World Terrain Mesh at Impact Coordinates
    const carveTerrainCraterInMesh = (
      cx: number,
      cz: number,
      radius: number,
      depth: number
    ) => {
      const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
      const colAttr = groundGeo.attributes.color as THREE.BufferAttribute;

      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const d = Math.hypot(vx - cx, vz - cz);
        if (d < radius * 1.4) {
          const u = d / radius;
          let deltaY = 0;
          if (u <= 1.0) {
            deltaY = -depth * Math.cos(u * Math.PI * 0.5) * (1 - u * u * 0.35);
            const charFactor = Math.max(0.18, u * 0.85);
            colAttr.setXYZ(
              i,
              colAttr.getX(i) * charFactor,
              colAttr.getY(i) * charFactor * 0.92,
              colAttr.getZ(i) * charFactor * 0.85
            );
          } else if (u <= 1.35) {
            const rimT = (u - 1.0) / 0.35;
            deltaY = depth * 0.18 * Math.sin(rimT * Math.PI);
            colAttr.setXYZ(
              i,
              colAttr.getX(i) * 0.78,
              colAttr.getY(i) * 0.75,
              colAttr.getZ(i) * 0.72
            );
          }
          posAttr.setY(i, posAttr.getY(i) + deltaY);
        }
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      groundGeo.computeVertexNormals();

      const impactY = terrainHeightAt(cx, propsRef.current.arena, cz);
      const craterDecal = createCraterDecalMesh(
        cx,
        impactY,
        cz,
        radius,
        depth,
        concretePbrMaps
      );
      craterGroup.add(craterDecal);
    };

    // 12. Rebuild Open-World Terrain & Structures on Stage Change
    const rebuildArena = (arena: BattlefieldConfig) => {
      const pal = getBiomePalette(arena.biome);
      scene.fog = new THREE.FogExp2(pal.fogColor, 0.0038);

      // Update Physical Sky Shader sun position & atmospheric parameters
      skyUniforms['turbidity'].value = pal.turbidity;
      skyUniforms['rayleigh'].value = pal.rayleigh;
      const phi = THREE.MathUtils.degToRad(90 - pal.sunElevationDeg);
      const theta = THREE.MathUtils.degToRad(38);
      const sunVec = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
      skyUniforms['sunPosition'].value.copy(sunVec);
      sunLight.position.copy(sunVec).multiplyScalar(85);

      const bMaps = getBiomeMaps(arena.biome);
      groundMat.map = bMaps.map;
      groundMat.normalMap = bMaps.normalMap;
      groundMat.roughnessMap = bMaps.roughnessMap;
      groundMat.needsUpdate = true;

      sunLight.color.setHex(pal.sunColor);
      sunLight.intensity = pal.sunIntensity;
      hemiLight.color.setHex(pal.ambientColor);
      hemiLight.groundColor.setHex(pal.groundSubColor);
      weatherMat.color.setHex(pal.weatherColor);

      const posAttr = groundGeo.attributes.position as THREE.BufferAttribute;
      const colAttr = groundGeo.attributes.color as THREE.BufferAttribute;
      const topC = new THREE.Color(pal.groundColor);
      const subC = new THREE.Color(pal.groundSubColor);
      const cliffC = new THREE.Color(0x78716c);

      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const h = terrainHeightAt(vx, arena, vz);
        posAttr.setY(i, h);

        // Blend sand/grass flats with rocky mountain slopes
        const radial = Math.hypot(vx, vz);
        const mixT = Math.max(0, Math.min(1, (h + 2.5) / 8.0));
        _color.copy(subC).lerp(topC, mixT * 0.65 + 0.35);
        if (radial > 85 || h > 5.5) {
          _color.lerp(cliffC, Math.min(0.65, (h - 4.0) * 0.12));
        }
        colAttr.setXYZ(i, _color.r, _color.g, _color.b);
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      groundGeo.computeVertexNormals();

      // Clear and rebuild Open-World Scenery (Roads, Instanced Trees & Rocks)
      while (openWorldSceneryHolder.children.length > 0) {
        openWorldSceneryHolder.remove(openWorldSceneryHolder.children[0]);
      }
      openWorldSceneryHolder.add(createOpenWorldScenery(arena, concretePbrMaps));

      // Clear previous stage craters
      while (craterGroup.children.length > 0) {
        craterGroup.remove(craterGroup.children[0]);
      }
      if (arena.craters && arena.craters.length > 0) {
        for (const c of arena.craters) {
          const cy = terrainHeightAt(c.x, arena, c.z);
          craterGroup.add(
            createCraterDecalMesh(c.x, cy, c.z, c.radius, c.depth, concretePbrMaps)
          );
        }
      }

      // Rebuild Destructible Military Structures
      while (obstacleGroup.children.length > 0) {
        obstacleGroup.remove(obstacleGroup.children[0]);
      }
      obstacleRigs = arena.obstacles.map((obs) => {
        const rig = createObstacleRig(obs, concretePbrMaps);
        rig.group.visible = !obs.destroyed;
        obstacleGroup.add(rig.group);
        return rig;
      });

      // Rebuild Supply Crates
      while (crateGroup.children.length > 0) {
        crateGroup.remove(crateGroup.children[0]);
      }
      crateRigs = arena.crates.map((crate) => {
        const rig = createSupplyCrateMesh(crate);
        rig.group.visible = !crate.collected;
        crateGroup.add(rig.group);
        return rig;
      });

      if (tankRigs) {
        for (const r of tankRigs) {
          if (r.flyingTurret) {
            scene.remove(r.flyingTurret.mesh);
            r.flyingTurret = null;
          }
        }
        tankRigs = null;
        ensureTankRigs(propsRef.current.tanks[0], propsRef.current.tanks[1]);
      }
    };

    rebuildSceneArenaRef.current = rebuildArena;
    rebuildArena(propsRef.current.arena);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 13. Active Shell Flight State
    let activeFlight: {
      shooterId: 1 | 2;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      t: number;
      trailCount: number;
      shellColor: number;
    } | null = null;

    let cameraTrauma = 0;
    let hitstopTimer = 0;
    const lastPosX: [number, number] = [
      propsRef.current.tanks[0].x,
      propsRef.current.tanks[1].x,
    ];
    const lastPosZ: [number, number] = [
      propsRef.current.tanks[0].z,
      propsRef.current.tanks[1].z,
    ];

    fireProjectileRef.current = (trigger: ActiveShotTrigger) => {
      const currentProps = propsRef.current;
      const shooter = currentProps.tanks[trigger.shooterId - 1];
      const tempTank: TankCombatState = {
        ...shooter,
        barrelAngleDeg: trigger.barrelAngleDeg,
        powerPct: trigger.powerPct,
        turretYawRad: trigger.turretYawRad,
      };
      const muzzle = getTankMuzzleOrigin(tempTank);
      const speed = powerToMuzzleVelocity(
        trigger.powerPct,
        shooter.shell.muzzleVelocityMultiplier
      );
      const elevRad = (trigger.barrelAngleDeg * Math.PI) / 180;
      const worldYaw = getTankWorldAimYaw(tempTank);

      scene.remove(activeShellGroup);
      activeShellGroup = createShellMesh(shooter.shell.colorHex);
      activeShellGroup.position.set(muzzle.x, muzzle.y, muzzle.z);
      activeShellGroup.visible = true;
      scene.add(activeShellGroup);

      if (tankRigs) {
        const rig = tankRigs[trigger.shooterId - 1];
        rig.recoilOffset = 0.48;
        const flashMat = rig.muzzleFlashMesh.material as THREE.MeshBasicMaterial;
        flashMat.opacity = 1.0;
      }

      spawnBurst(
        muzzle.x,
        muzzle.y,
        muzzle.z,
        24,
        [shooter.shell.colorHex, 0xfef08a, 0x94a3b8],
        0.95
      );
      cameraTrauma = Math.max(cameraTrauma, 0.42);
      soundEngine.playCannonFire(shooter.shell.damageMultiplier);
      soundEngine.startShellWhistle();

      trailPositions[0] = muzzle.x;
      trailPositions[1] = muzzle.y;
      trailPositions[2] = muzzle.z;
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.setDrawRange(0, 1);

      activeFlight = {
        shooterId: trigger.shooterId,
        x: muzzle.x,
        y: muzzle.y,
        z: muzzle.z,
        vx: speed * Math.cos(elevRad) * Math.cos(worldYaw),
        vy: speed * Math.sin(elevRad),
        vz: speed * Math.cos(elevRad) * Math.sin(worldYaw),
        t: 0,
        trailCount: 1,
        shellColor: shooter.shell.colorHex,
      };
    };

    // 14. Keyboard Listener (WASD / Arrow Keys for Open-World Driving)
    const keysPressed = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      keysPressed.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysPressed.delete(e.code);
    };
    const onBlur = () => {
      keysPressed.clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // 15. Pointer Drag Listener on 3D Canvas for 360-Degree Turret Rotation + Elevation/Power
    let isDraggingAim = false;
    let lastClientX = 0;
    let dragStartY = 0;
    let dragStartAngle = 36;
    let dragStartPower = 72;

    const onPointerDown = (e: PointerEvent) => {
      const p = propsRef.current;
      if (p.appState !== 'playing' || activeFlight) return;
      isDraggingAim = true;
      lastClientX = e.clientX;
      dragStartY = e.clientY;
      const activeTank = p.tanks[0];
      dragStartAngle = activeTank.barrelAngleDeg;
      dragStartPower = activeTank.powerPct;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingAim) return;
      const p = propsRef.current;
      if (p.appState !== 'playing' || activeFlight) {
        isDraggingAim = false;
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      const deltaX = (e.clientX - lastClientX) / Math.max(240, rect.width);
      lastClientX = e.clientX;
      const dy = (e.clientY - dragStartY) / Math.max(220, rect.height);

      // Dragging horizontally rotates the turret in 360-degree space; dragging vertically elevates barrel & adjusts power
      const deltaYawRad = deltaX * 2.8;
      const elevDelta = -dy * 75;
      const powerDelta = -dy * 55;

      const newAngle = Math.round(Math.max(5, Math.min(75, dragStartAngle + elevDelta)));
      const newPower = Math.round(Math.max(25, Math.min(100, dragStartPower + powerDelta)));

      soundEngine.playTurretServo(newPower);
      p.onAimChange(newAngle, newPower, deltaYawRad);
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
      camera.fov = aspect < 1 ? 58 : 46;
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
    let lastAppState = propsRef.current.appState;

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

      // 0. Process Continuous Open-World Driving Input (WASD / Arrow Keys / On-Screen Drive Buttons)
      if (currentProps.appState === 'playing' && currentProps.onContinuousDrive) {
        let throttle = currentProps.driveInput?.throttle ?? 0;
        let steer = currentProps.driveInput?.steer ?? 0;

        if (keysPressed.has('KeyW') || keysPressed.has('ArrowUp')) throttle += 1;
        if (keysPressed.has('KeyS') || keysPressed.has('ArrowDown')) throttle -= 1;
        if (keysPressed.has('KeyA') || keysPressed.has('ArrowLeft')) steer -= 1;
        if (keysPressed.has('KeyD') || keysPressed.has('ArrowRight')) steer += 1;

        throttle = Math.max(-1, Math.min(1, throttle));
        steer = Math.max(-1, Math.min(1, steer));

        if (Math.abs(throttle) > 0.01 || Math.abs(steer) > 0.01) {
          currentProps.onContinuousDrive(throttle, steer, dt);
        }
      }

      // 1. Update Tank Positions, 360-Degree Hull Yaw, Wheel Rotation, Track Dust, & Turret Blow-Off
      ensureTankRigs(currentProps.tanks[0], currentProps.tanks[1]);
      const stateJustChanged = lastAppState !== currentProps.appState;
      lastAppState = currentProps.appState;

      if (tankRigs) {
        for (let i = 0; i < 2; i++) {
          const tState = currentProps.tanks[i];
          const rig = tankRigs[i];

          if (currentProps.appState === 'garage' || currentProps.appState === 'shop') {
            if (i === 0) {
              rig.root.position.set(0, terrainHeightAt(0, currentProps.arena, 0), 0);
              rig.root.visible = true;
            } else {
              rig.root.visible = false;
            }
          } else {
            rig.root.visible = true;
            if (stateJustChanged) {
              rig.root.position.set(tState.x, tState.y, tState.z);
              lastPosX[i] = tState.x;
              lastPosZ[i] = tState.z;
            } else {
              rig.root.position.x = THREE.MathUtils.lerp(
                rig.root.position.x,
                tState.x,
                1 - Math.exp(-14 * dt)
              );
              rig.root.position.y = THREE.MathUtils.lerp(
                rig.root.position.y,
                tState.y,
                1 - Math.exp(-14 * dt)
              );
              rig.root.position.z = THREE.MathUtils.lerp(
                rig.root.position.z,
                tState.z,
                1 - Math.exp(-14 * dt)
              );
            }
          }

          const moveDist = Math.hypot(
            rig.root.position.x - lastPosX[i],
            rig.root.position.z - lastPosZ[i]
          );
          lastPosX[i] = rig.root.position.x;
          lastPosZ[i] = rig.root.position.z;

          if (moveDist > 0.002) {
            for (const wheel of rig.wheels) {
              wheel.rotation.z -= moveDist * 3.2;
            }
            // Kick up realistic open-world track dust plumes while driving
            if (Math.random() < 0.45) {
              spawnBurst(
                rig.root.position.x,
                rig.root.position.y + 0.25,
                rig.root.position.z,
                2,
                [0xd6d3d1, 0xa8a29e],
                0.35
              );
            }
          }

          updateTankPose(
            rig,
            tState.facing,
            tState.barrelAngleDeg,
            tState.turretYawRad,
            tState.slopeAngle,
            dt,
            tState.hullYaw,
            tState.rollAngle ?? 0
          );

          stepFlyingTurret(rig, dt, (gx, gz) =>
            terrainHeightAt(gx, currentProps.arena, gz)
          );
        }
      }

      // 2. Sync Destructible Obstacles, Rotate Radar Dishes & Float Supply Crates
      const isShowcase =
        currentProps.appState === 'garage' || currentProps.appState === 'shop';
      obstacleGroup.visible = !isShowcase;
      crateGroup.visible = !isShowcase;

      if (!isShowcase) {
        for (let i = 0; i < obstacleRigs.length; i++) {
          const obsData = currentProps.arena.obstacles[i];
          if (obsData && obstacleRigs[i]) {
            obstacleRigs[i].group.visible = !obsData.destroyed;
            if (obstacleRigs[i].radarSpinner && !obsData.destroyed) {
              obstacleRigs[i].radarSpinner!.rotation.y = elapsed * 1.4;
            }
          }
        }
        for (let i = 0; i < crateRigs.length; i++) {
          const crateData = currentProps.arena.crates[i];
          if (crateData && crateRigs[i]) {
            crateRigs[i].group.visible = !crateData.collected;
            crateRigs[i].group.rotation.y = elapsed * 1.2 + i;
            crateRigs[i].group.position.y =
              crateData.y + 0.55 + Math.sin(elapsed * 2.5 + i) * 0.1;
          }
        }
      }

      // 3. Update Short Dashed Trajectory Preview Line next to Player Tank Barrel (3-5m)
      const showPreview =
        currentProps.appState === 'playing' &&
        !activeFlight &&
        currentProps.tanks[0].hp > 0;

      previewLine.visible = showPreview;
      reticleMesh.visible = showPreview;

      if (showPreview) {
        const activeTank = currentProps.tanks[0];
        const pts = computeShortTrajectoryPreview(
          activeTank,
          currentProps.windSpeed,
          TRAJECTORY_PREVIEW_MAX_METERS
        );
        const count = Math.min(pts.length, maxPreviewPts);
        for (let i = 0; i < count; i++) {
          previewPositions[i * 3] = pts[i].x;
          previewPositions[i * 3 + 1] = pts[i].y;
          previewPositions[i * 3 + 2] = pts[i].z;
        }
        previewGeo.attributes.position.needsUpdate = true;
        previewGeo.setDrawRange(0, count);
        previewLine.computeLineDistances();

        const tip = pts[count - 1];
        reticleMesh.position.set(tip.x, tip.y, tip.z);
        reticleMesh.lookAt(camera.position);
      }

      // 4. Step Flying Shell & Check 3D Open-World Collisions
      if (activeFlight && hitstopTimer <= 0) {
        const subSteps = 4;
        const subDt = dt / subSteps;

        for (let s = 0; s < subSteps; s++) {
          if (!activeFlight) break;
          const next = stepProjectile(activeFlight, subDt, currentProps.windSpeed);
          const hit = evaluatePointCollision(
            next.x,
            next.y,
            next.z,
            activeFlight.shooterId,
            currentProps.tanks,
            currentProps.arena,
            next.t
          );

          activeFlight.x = next.x;
          activeFlight.y = next.y;
          activeFlight.z = next.z;
          activeFlight.vx = next.vx;
          activeFlight.vy = next.vy;
          activeFlight.vz = next.vz;
          activeFlight.t = next.t;

          const curSpeed = Math.hypot(activeFlight.vx, activeFlight.vy, activeFlight.vz);
          soundEngine.updateShellWhistle(curSpeed, activeFlight.vy);

          activeShellGroup.position.set(activeFlight.x, activeFlight.y, activeFlight.z);
          const dirVec = new THREE.Vector3(
            activeFlight.vx,
            activeFlight.vy,
            activeFlight.vz
          ).normalize();
          const upQuat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(1, 0, 0),
            dirVec
          );
          activeShellGroup.quaternion.copy(upQuat);

          if (activeFlight.trailCount < maxTrailPts) {
            const idx = activeFlight.trailCount * 3;
            trailPositions[idx] = activeFlight.x;
            trailPositions[idx + 1] = activeFlight.y;
            trailPositions[idx + 2] = activeFlight.z;
            activeFlight.trailCount++;
            trailGeo.attributes.position.needsUpdate = true;
            trailGeo.setDrawRange(0, activeFlight.trailCount);
          }

          if (hit.hitType !== 'none' || next.t > 12.0) {
            const resolvedHit: HitDetectionResult =
              hit.hitType !== 'none'
                ? hit
                : {
                    hitType: 'ground',
                    craterRadius: 3.0,
                    craterDepth: 0.85,
                    impactPoint: {
                      x: activeFlight.x,
                      y: terrainHeightAt(
                        activeFlight.x,
                        currentProps.arena,
                        activeFlight.z
                      ),
                      z: activeFlight.z,
                    },
                  };

            activeShellGroup.visible = false;
            const ix = resolvedHit.impactPoint.x;
            const iy = resolvedHit.impactPoint.y;
            const iz = resolvedHit.impactPoint.z;

            soundEngine.stopShellWhistle();

            // Physically carve a 3D crater into the terrain mesh on ground or splash impacts!
            if (resolvedHit.craterRadius && resolvedHit.craterDepth) {
              carveTerrainCraterInMesh(
                ix,
                iz,
                resolvedHit.craterRadius,
                resolvedHit.craterDepth
              );
            }

            shockwaveMesh.position.set(ix, iy + 0.15, iz);
            shockwaveTimer = 0.48;

            if (resolvedHit.hitType === 'tank' && resolvedHit.targetTankId) {
              const targetTank = currentProps.tanks[resolvedHit.targetTankId - 1];
              const isFatal = targetTank.hp - (resolvedHit.damage ?? 0) <= 0;

              soundEngine.playExplosion(
                resolvedHit.hitZone === 'turret' ? 'turret_crit' : 'armor',
                isFatal
              );
              spawnBurst(
                ix,
                iy,
                iz,
                isFatal ? 60 : 34,
                [0xf97316, 0xef4444, 0xfef08a, 0x334155],
                isFatal ? 1.65 : 1.15
              );
              cameraTrauma = isFatal ? 0.95 : 0.6;
              hitstopTimer = isFatal ? 0.08 : 0.045;

              if (isFatal && tankRigs) {
                triggerTankExplosion(tankRigs[resolvedHit.targetTankId - 1], scene);
              }
            } else if (resolvedHit.hitType === 'crate') {
              soundEngine.playCratePickup();
              spawnBurst(ix, iy, iz, 28, [0x10b981, 0xfbbf24, 0xffffff], 1.0);
              cameraTrauma = 0.3;
            } else if (resolvedHit.hitType === 'obstacle') {
              soundEngine.playExplosion('obstacle');
              spawnBurst(ix, iy, iz, 36, [0xf97316, 0x94a3b8, 0x475569], 1.2);
              cameraTrauma = 0.48;
            } else {
              soundEngine.playExplosion('ground');
              spawnBurst(
                ix,
                iy,
                iz,
                34,
                [0xd97706, 0x78350f, 0x292524, 0xf59e0b],
                1.15
              );
              cameraTrauma = 0.35;
            }

            const landingX = ix;
            activeFlight = null;
            currentProps.onShotResolved(resolvedHit, landingX);
            break;
          }
        }
      }

      // 5. Step Shockwave Ring & Pooled Particles
      if (shockwaveTimer > 0) {
        shockwaveTimer = Math.max(0, shockwaveTimer - dt);
        const progress = 1 - shockwaveTimer / 0.48;
        const s = 0.6 + progress * 7.2;
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

        if (x > 80) x = -80;
        if (x < -80) x = 80;
        if (y < -2) y = 32;

        const streakX = windVx * 0.045;
        const streakY = fallVy * 0.045;
        wAttr.setXYZ(idx, x, y, z);
        wAttr.setXYZ(idx + 1, x + streakX, y + streakY, z);
      }
      wAttr.needsUpdate = true;

      // 7. 360-Degree Open-World Camera Choreography (Garage Showcase + 5 Battle Camera Presets)
      const p1 = currentProps.tanks[0];
      const p2 = currentProps.tanks[1];
      const midX = (p1.x + p2.x) * 0.5;
      const midY = (p1.y + p2.y) * 0.5 + 1.8;
      const midZ = (p1.z + p2.z) * 0.5;
      const isPortrait = camera.aspect < 1.0;

      if (currentProps.appState === 'garage' || currentProps.appState === 'shop') {
        const baseY = terrainHeightAt(0, currentProps.arena, 0);
        const swayAngle = 0.62 + Math.sin(elapsed * 0.48) * 0.42;
        const radius = isPortrait ? 7.5 : 6.5;
        _camTargetPos.set(
          Math.cos(swayAngle) * radius,
          baseY + (isPortrait ? 2.25 : 2.3),
          Math.sin(swayAngle) * radius
        );
        _camLookTarget.set(0.15, baseY + (isPortrait ? -0.35 : 0.52), 0);
        camera.position.copy(_camTargetPos);
        currentCamLook.copy(_camLookTarget);
      } else if (activeFlight && currentProps.cameraPreset === 'cinematic') {
        const velAngle = Math.atan2(activeFlight.vz, activeFlight.vx);
        const chaseDist = isPortrait ? 11.5 : 9.5;
        _camTargetPos.set(
          activeFlight.x - Math.cos(velAngle) * chaseDist,
          Math.max(3.4, activeFlight.y + 3.2),
          activeFlight.z - Math.sin(velAngle) * chaseDist + 3.5
        );
        _camLookTarget.set(
          activeFlight.x + Math.cos(velAngle) * 5.0,
          Math.max(1.2, activeFlight.y + 0.2),
          activeFlight.z + Math.sin(velAngle) * 5.0
        );
      } else if (currentProps.cameraPreset === 'turret') {
        // Commander Turret Chase Camera aligned with 360-degree world aim yaw
        const aimYaw = getTankWorldAimYaw(p1);
        const backDist = isPortrait ? 9.6 : 8.2;
        _camTargetPos.set(
          p1.x - Math.cos(aimYaw) * backDist,
          p1.y + (isPortrait ? 4.4 : 3.7),
          p1.z - Math.sin(aimYaw) * backDist
        );
        _camLookTarget.set(
          p1.x + Math.cos(aimYaw) * 18.0,
          p1.y + 2.1,
          p1.z + Math.sin(aimYaw) * 18.0
        );
      } else if (currentProps.cameraPreset === 'drone') {
        // High-Altitude Tactical UAV Drone Camera over the Open World
        const sep = Math.max(45, Math.hypot(p2.x - p1.x, p2.z - p1.z));
        _camTargetPos.set(
          midX,
          midY + (isPortrait ? sep * 1.15 : sep * 0.82),
          midZ + (isPortrait ? 22 : 28)
        );
        _camLookTarget.set(midX, midY - 1.0, midZ);
      } else if (currentProps.cameraPreset === 'side') {
        // Wide Panoramic Open-World Camera framing both tanks
        const sep = Math.max(48, Math.hypot(p2.x - p1.x, p2.z - p1.z));
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const perpAngle = Math.atan2(dz, dx) + Math.PI * 0.5;
        const camDist = isPortrait ? sep * 1.18 : sep * 0.92;
        _camTargetPos.set(
          midX + Math.cos(perpAngle) * camDist,
          midY + 8.5,
          midZ + Math.sin(perpAngle) * camDist
        );
        _camLookTarget.set(midX, midY - 0.3, midZ);
      } else {
        // Default 'tactical': 360-Degree Open-World Third-Person Chase Camera behind player tank
        const aimYaw = getTankWorldAimYaw(p1);
        const chaseBack = isPortrait ? 15.2 : 13.5;
        const sideOffset = isPortrait ? 2.6 : 3.4;
        _camTargetPos.set(
          p1.x - Math.cos(aimYaw) * chaseBack - Math.sin(aimYaw) * sideOffset,
          p1.y + (isPortrait ? 6.8 : 5.8),
          p1.z - Math.sin(aimYaw) * chaseBack + Math.cos(aimYaw) * sideOffset
        );
        _camLookTarget.set(
          p1.x + Math.cos(aimYaw) * 16.0,
          p1.y + 1.8,
          p1.z + Math.sin(aimYaw) * 16.0
        );
      }

      if (stateJustChanged) {
        camera.position.copy(_camTargetPos);
        currentCamLook.copy(_camLookTarget);
      } else {
        const damp = 1 - Math.exp(-8.5 * dt);
        camera.position.lerp(_camTargetPos, damp);
        currentCamLook.lerp(_camLookTarget, damp);
      }

      // Ensure camera never clips below terrain height
      const camGroundY = terrainHeightAt(
        camera.position.x,
        currentProps.arena,
        camera.position.z
      );
      if (camera.position.y < camGroundY + 1.4) {
        camera.position.y = camGroundY + 1.4;
      }

      if (cameraTrauma > 0) {
        cameraTrauma = Math.max(0, cameraTrauma - dt * 1.7);
        const shake = cameraTrauma * cameraTrauma * 0.65;
        camera.position.x += Math.sin(elapsed * 52) * shake;
        camera.position.y += Math.cos(elapsed * 46) * shake;
      }

      camera.lookAt(currentCamLook);
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      isUnmounted = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      soundEngine.stopShellWhistle();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    if (rebuildSceneArenaRef.current) {
      rebuildSceneArenaRef.current(props.arena);
    }
  }, [
    props.arena.seed,
    props.arena.stageNumber,
    props.tanks[0].model.id,
    props.tanks[1].model.id,
  ]);

  useEffect(() => {
    if (
      props.shotTrigger &&
      props.shotTrigger.shotId !== lastFiredShotIdRef.current &&
      fireProjectileRef.current
    ) {
      lastFiredShotIdRef.current = props.shotTrigger.shotId;
      fireProjectileRef.current(props.shotTrigger);
    }
  }, [props.shotTrigger]);

  return (
    <div
      ref={mountRef}
      data-testid="arena-3d-canvas"
      className="fixed inset-0 w-full h-full overflow-hidden select-none z-0"
    />
  );
};
