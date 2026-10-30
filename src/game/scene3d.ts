import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  computeTrajectoryPreview,
  getBowLaunchOrigin,
  powerToSpeed,
  terrainHeightAt,
  type ArenaConfig,
  type ArcherState,
  type DestructibleObstacle,
  type WeatherType,
} from './physics';

export interface RagdollLimb {
  mesh: THREE.Object3D;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  groundOffset: number;
}

export interface ArcherRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  bowArm: THREE.Group;
  drawArm: THREE.Group;
  bowString: THREE.Line;
  bowStringPositions: Float32Array;
  nockedArrow: THREE.Group;
  hitFlashMaterials: THREE.MeshStandardMaterial[];
  baseColors: number[];
  flashTimer: number;
  ragdollActive: boolean;
  ragdollLimbs: RagdollLimb[];
}

export interface ObstacleRig {
  id: string;
  group: THREE.Group;
  flashTimer: number;
  materials: THREE.MeshStandardMaterial[];
  baseColors: number[];
}

export function detectSoftwareWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

/**
 * Create procedural bump & grain texture for wood/stone/terrain
 */
export function createProceduralGrainTexture(
  renderer: THREE.WebGLRenderer,
  baseHex: string,
  accentHex: string,
  isColorMap: boolean
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = accentHex;
  for (let i = 0; i < 240; i++) {
    const x = (i * 37) % 128;
    const y = (i * 73) % 128;
    const w = 4 + (i % 12);
    const h = 2 + (i % 4);
    ctx.globalAlpha = 0.12 + (i % 5) * 0.04;
    ctx.fillRect(x, y, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (isColorMap) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  return tex;
}

/**
 * Soft radial contact shadow plane placed at y = 0.015 beneath grounded objects
 */
export function createContactShadowDisc(radius: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new THREE.CanvasTexture(canvas);
  const geo = new THREE.CircleGeometry(radius, 20);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.018;
  return mesh;
}

/**
 * Build a 3D Arrow mesh group (shaft, steel broadhead tip, 3 fletching feathers)
 */
export function createArrowMesh(): THREE.Group {
  const group = new THREE.Group();

  // Wooden shaft along +X axis
  const shaftGeo = new THREE.CylinderGeometry(0.022, 0.022, 1.15, 8);
  shaftGeo.rotateZ(-Math.PI / 2);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0xdab88b,
    roughness: 0.65,
    metalness: 0.08,
  });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  group.add(shaft);

  // Broadhead steel tip at +0.62m
  const tipGeo = new THREE.ConeGeometry(0.055, 0.22, 6);
  tipGeo.rotateZ(-Math.PI / 2);
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.88,
  });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.x = 0.62;
  group.add(tip);

  // Glowing tail fletching feathers at -0.52m for clear visual readability in flight
  const featherGeo = new THREE.BoxGeometry(0.22, 0.09, 0.015);
  const featherMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(featherGeo, featherMat);
    f.position.x = -0.48;
    f.rotation.x = (i * Math.PI * 2) / 3;
    group.add(f);
  }

  return group;
}

/**
 * Build a 10-part composite 3D Archer model with articulated limbs, helmet, quiver, bow &ragdoll support
 */
export function createCompositeArcher(isPlayer1: boolean, isSoftwareGl: boolean): ArcherRig {
  const root = new THREE.Group();
  const hitFlashMaterials: THREE.MeshStandardMaterial[] = [];
  const baseColors: number[] = [];

  const registerMat = (mat: THREE.MeshStandardMaterial) => {
    hitFlashMaterials.push(mat);
    baseColors.push(mat.color.getHex());
    return mat;
  };

  // Contact shadow at feet
  root.add(createContactShadowDisc(0.95));

  const primaryArmorHex = isPlayer1 ? 0x1d4ed8 : 0xb91c1c; // Royal Cobalt vs Crimson Guard
  const trimBrassHex = isPlayer1 ? 0xf59e0b : 0xfbbf24;
  const clothHex = isPlayer1 ? 0x1e293b : 0x27272a;
  const leatherHex = 0x5c3a21;
  const skinHex = 0xd6a77a;

  const armorMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: primaryArmorHex,
      roughness: 0.35,
      metalness: 0.45,
    })
  );
  const brassMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: trimBrassHex,
      roughness: 0.22,
      metalness: 0.85,
    })
  );
  const clothMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: clothHex,
      roughness: 0.82,
      metalness: 0.05,
    })
  );
  const leatherMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: leatherHex,
      roughness: 0.72,
      metalness: 0.1,
    })
  );
  const skinMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: skinHex,
      roughness: 0.65,
      metalness: 0.05,
    })
  );

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  // 1 & 2: Left & Right Legs + Armored Greaves
  const makeLeg = (zOffset: number) => {
    const legGroup = new THREE.Group();
    legGroup.position.set(0, 0, zOffset);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.52, 8), clothMat);
    thigh.position.y = -0.25;
    thigh.castShadow = !isSoftwareGl;
    legGroup.add(thigh);

    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.44, 8), leatherMat);
    boot.position.y = -0.68;
    boot.castShadow = !isSoftwareGl;
    legGroup.add(boot);

    const kneeGuard = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), brassMat);
    kneeGuard.position.set(0.05, -0.46, 0);
    legGroup.add(kneeGuard);

    return legGroup;
  };

  const leftLeg = makeLeg(0.16);
  const rightLeg = makeLeg(-0.16);
  hips.add(leftLeg);
  hips.add(rightLeg);

  // 3: Torso Cuirass & Belt
  const torso = new THREE.Group();
  hips.add(torso);

  const chestMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.23, 0.84, 10), armorMat);
  chestMesh.position.y = 0.42;
  chestMesh.castShadow = !isSoftwareGl;
  torso.add(chestMesh);

  const beltMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.12, 10), leatherMat);
  beltMesh.position.y = 0.08;
  torso.add(beltMesh);

  const buckleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.18), brassMat);
  buckleMesh.position.set(0.23, 0.08, 0);
  torso.add(buckleMesh);

  // 4: Pauldrons (Shoulder Guards)
  for (const side of [-1, 1]) {
    const pauldron = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
      brassMat
    );
    pauldron.position.set(0, 0.78, side * 0.28);
    torso.add(pauldron);
  }

  // 5: Back Quiver with Arrows
  const quiverGroup = new THREE.Group();
  quiverGroup.position.set(-0.22, 0.52, -0.18);
  quiverGroup.rotation.z = 0.32;
  const quiverTube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.55, 8), leatherMat);
  quiverGroup.add(quiverTube);
  for (let i = 0; i < 3; i++) {
    const qShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 6), brassMat);
    qShaft.position.set((i - 1) * 0.03, 0.28, (i % 2) * 0.02);
    quiverGroup.add(qShaft);
  }
  torso.add(quiverGroup);

  // 6: Articulated Head + Spangenhelm Helmet + Plume
  const head = new THREE.Group();
  head.position.y = 0.92;
  torso.add(head);

  const headSphere = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 12), skinMat);
  headSphere.position.y = 0.21;
  headSphere.castShadow = !isSoftwareGl;
  head.add(headSphere);

  // Conical Persian/Medieval Helmet
  const helmetDome = new THREE.Mesh(new THREE.ConeGeometry(0.235, 0.34, 12), brassMat);
  helmetDome.position.y = 0.36;
  helmetDome.castShadow = !isSoftwareGl;
  head.add(helmetDome);

  // Nasal guard bar
  const nasalBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), brassMat);
  nasalBar.position.set(0.21, 0.24, 0);
  head.add(nasalBar);

  // Flowing helmet plume crest
  const plumeMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: isPlayer1 ? 0x38bdf8 : 0xf87171,
      roughness: 0.5,
      metalness: 0.1,
    })
  );
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 8), plumeMat);
  plume.position.set(-0.08, 0.54, 0);
  plume.rotation.z = 0.65;
  head.add(plume);

  // 7: Articulated Bow Arm + Composite Recurve Bow
  const bowArm = new THREE.Group();
  bowArm.position.set(0.06, 0.68, 0.24);
  torso.add(bowArm);

  const foreArm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.52, 8), skinMat);
  foreArm.rotation.z = -Math.PI / 2;
  foreArm.position.x = 0.26;
  bowArm.add(foreArm);

  const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.075, 0.22, 8), leatherMat);
  bracer.rotation.z = -Math.PI / 2;
  bracer.position.x = 0.34;
  bowArm.add(bracer);

  // Composite Recurve Bow using TubeGeometry along a CatmullRomCurve3
  const bowCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.46, 0.68, 0),
    new THREE.Vector3(0.56, 0.45, 0),
    new THREE.Vector3(0.64, 0.18, 0),
    new THREE.Vector3(0.58, 0.0, 0),
    new THREE.Vector3(0.64, -0.18, 0),
    new THREE.Vector3(0.56, -0.45, 0),
    new THREE.Vector3(0.46, -0.68, 0),
  ]);
  const bowGeo = new THREE.TubeGeometry(bowCurve, 20, 0.032, 8, false);
  const bowMesh = new THREE.Mesh(bowGeo, brassMat);
  bowArm.add(bowMesh);

  // Bow grip handle
  const bowGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.2, 8), leatherMat);
  bowGrip.position.set(0.58, 0, 0);
  bowArm.add(bowGrip);

  // 8: Dynamic Bowstring (3 vertices: top tip -> nock point -> bottom tip)
  const bowStringPositions = new Float32Array([
    0.46, 0.68, 0,
    0.15, 0.0, 0,
    0.46, -0.68, 0,
  ]);
  const stringGeo = new THREE.BufferGeometry();
  stringGeo.setAttribute('position', new THREE.BufferAttribute(bowStringPositions, 3));
  const stringMat = new THREE.LineBasicMaterial({ color: 0xf8fafc });
  const bowString = new THREE.Line(stringGeo, stringMat);
  bowArm.add(bowString);

  // 9: Nocked Arrow inside the bow
  const nockedArrow = createArrowMesh();
  nockedArrow.position.set(0.32, 0, 0);
  bowArm.add(nockedArrow);

  // 10: Draw Arm (right arm pulling the bowstring)
  const drawArm = new THREE.Group();
  drawArm.position.set(-0.04, 0.68, -0.24);
  torso.add(drawArm);
  const drawArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.46, 8), armorMat);
  drawArmMesh.rotation.z = -Math.PI / 2;
  drawArmMesh.position.x = 0.2;
  drawArm.add(drawArmMesh);

  return {
    root,
    hips,
    torso,
    head,
    leftLeg,
    rightLeg,
    bowArm,
    drawArm,
    bowString,
    bowStringPositions,
    nockedArrow,
    hitFlashMaterials,
    baseColors,
    flashTimer: 0,
    ragdollActive: false,
    ragdollLimbs: [],
  };
}

/**
 * Update archer aim pose (elevation angle + bowstring draw percentage + subtle idle breathing)
 */
export function updateArcherPose(
  rig: ArcherRig,
  archer: ArcherState,
  isCurrentTurn: boolean,
  elapsedTime: number
) {
  if (rig.ragdollActive) return;

  rig.root.position.set(archer.x, archer.y, 0);
  rig.root.scale.x = archer.facing;

  // Subtle idle breathing bob
  const breath = Math.sin(elapsedTime * 2.6 + archer.id * 1.7) * 0.025;
  rig.torso.position.y = breath;

  const targetRad = THREE.MathUtils.degToRad(archer.angleDeg);
  rig.bowArm.rotation.z = targetRad;
  rig.drawArm.rotation.z = targetRad * 0.85;
  rig.head.rotation.z = targetRad * 0.45;

  // Pull string & nocked arrow according to powerPct when aiming
  const pullRatio = isCurrentTurn ? (archer.powerPct - 10) / 90 : 0.15;
  const stringPullX = 0.44 - pullRatio * 0.42;
  rig.bowStringPositions[3] = stringPullX;
  rig.bowStringPositions[4] = 0;
  rig.bowStringPositions[5] = 0;
  (rig.bowString.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

  rig.nockedArrow.position.x = stringPullX + 0.48;
  rig.drawArm.position.x = stringPullX - 0.12;
}

/**
 * Activate multi-part Ragdoll physics when an archer is defeated
 */
export function triggerArcherRagdoll(
  rig: ArcherRig,
  scene: THREE.Scene,
  impactVx: number,
  impactVy: number
) {
  if (rig.ragdollActive) return;
  rig.ragdollActive = true;
  rig.nockedArrow.visible = false;

  const parts: Array<{ obj: THREE.Object3D; groundOffset: number; impulseScale: number }> = [
    { obj: rig.torso, groundOffset: 0.35, impulseScale: 1.0 },
    { obj: rig.head, groundOffset: 0.22, impulseScale: 1.45 },
    { obj: rig.leftLeg, groundOffset: 0.18, impulseScale: 0.7 },
    { obj: rig.rightLeg, groundOffset: 0.18, impulseScale: 0.7 },
    { obj: rig.bowArm, groundOffset: 0.15, impulseScale: 1.25 },
  ];

  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();

  rig.ragdollLimbs = parts.map(({ obj, groundOffset, impulseScale }, idx) => {
    obj.getWorldPosition(worldPos);
    obj.getWorldQuaternion(worldQuat);
    scene.attach(obj);
    obj.position.copy(worldPos);
    obj.quaternion.copy(worldQuat);

    const dirSign = Math.sign(impactVx) || 1;
    const speedMag = Math.min(14, Math.max(4, Math.hypot(impactVx, impactVy) * 0.32));

    return {
      mesh: obj,
      vx: dirSign * speedMag * impulseScale + (idx - 2) * 0.9,
      vy: (2.8 + idx * 0.65) * impulseScale,
      vz: (idx % 2 === 0 ? 1 : -1) * (0.8 + idx * 0.3),
      rx: (idx - 1.5) * 3.2,
      ry: dirSign * 2.5,
      rz: -dirSign * (4.0 + idx * 1.1),
      groundOffset,
    };
  });
}

/**
 * Step active Ragdoll limbs under gravity and terrain bounce
 */
export function stepRagdollPhysics(rig: ArcherRig, arena: ArenaConfig, dt: number) {
  if (!rig.ragdollActive) return;
  for (const limb of rig.ragdollLimbs) {
    limb.vy -= 9.81 * dt;
    limb.mesh.position.x += limb.vx * dt;
    limb.mesh.position.y += limb.vy * dt;
    limb.mesh.position.z += limb.vz * dt;

    limb.mesh.rotation.x += limb.rx * dt;
    limb.mesh.rotation.y += limb.ry * dt;
    limb.mesh.rotation.z += limb.rz * dt;

    const floorY = terrainHeightAt(limb.mesh.position.x, arena) + limb.groundOffset;
    if (limb.mesh.position.y <= floorY) {
      limb.mesh.position.y = floorY;
      limb.vy = Math.abs(limb.vy) * 0.28;
      limb.vx *= 0.68;
      limb.vz *= 0.68;
      limb.rx *= 0.65;
      limb.ry *= 0.65;
      limb.rz *= 0.65;
    }
  }
}

/**
 * Build composite 3D destructible obstacles (Wooden Barrel, Runic Boulder, Castle Wall)
 */
export function createCompositeObstacle(
  obs: DestructibleObstacle,
  woodTex: THREE.CanvasTexture,
  stoneTex: THREE.CanvasTexture,
  isSoftwareGl: boolean
): ObstacleRig {
  const group = new THREE.Group();
  group.position.set(obs.x, obs.y, 0);
  group.add(createContactShadowDisc(obs.width * 0.72));

  const materials: THREE.MeshStandardMaterial[] = [];
  const baseColors: number[] = [];
  const reg = (m: THREE.MeshStandardMaterial) => {
    materials.push(m);
    baseColors.push(m.color.getHex());
    return m;
  };

  if (obs.kind === 'barrel') {
    const staveMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: woodTex,
        roughness: 0.78,
        metalness: 0.08,
      })
    );
    const ironMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.35,
        metalness: 0.82,
      })
    );

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(obs.width * 0.44, obs.width * 0.42, obs.height, 12),
      staveMat
    );
    body.position.y = obs.height * 0.5;
    body.castShadow = !isSoftwareGl;
    body.receiveShadow = !isSoftwareGl;
    group.add(body);

    // 3 Iron hoops
    for (const hRatio of [0.22, 0.5, 0.78]) {
      const hoop = new THREE.Mesh(
        new THREE.CylinderGeometry(obs.width * 0.46, obs.width * 0.46, 0.09, 12),
        ironMat
      );
      hoop.position.y = obs.height * hRatio;
      group.add(hoop);
    }
  } else if (obs.kind === 'stone') {
    const rockMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneTex,
        roughness: 0.85,
        metalness: 0.1,
      })
    );
    const mossMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0x4d7c0f,
        roughness: 0.9,
        metalness: 0.02,
      })
    );

    const baseRock = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.width * 0.55, 1), rockMat);
    baseRock.scale.set(1.0, obs.height / (obs.width * 1.05), 0.9);
    baseRock.position.y = obs.height * 0.48;
    baseRock.castShadow = !isSoftwareGl;
    baseRock.receiveShadow = !isSoftwareGl;
    group.add(baseRock);

    const sideSpire = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.width * 0.34, 0), rockMat);
    sideSpire.position.set(obs.width * 0.28, obs.height * 0.28, 0.25);
    group.add(sideSpire);

    const mossCap = new THREE.Mesh(
      new THREE.CylinderGeometry(obs.width * 0.35, obs.width * 0.42, 0.18, 8),
      mossMat
    );
    mossCap.position.y = obs.height * 0.92;
    group.add(mossCap);
  } else {
    // Fortified Castle Wall with Battlements
    const masonryMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneTex,
        roughness: 0.8,
        metalness: 0.12,
      })
    );
    const trimMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0x78350f,
        roughness: 0.7,
        metalness: 0.15,
      })
    );

    const wallMain = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width, obs.height * 0.82, 2.2),
      masonryMat
    );
    wallMain.position.y = obs.height * 0.41;
    wallMain.castShadow = !isSoftwareGl;
    wallMain.receiveShadow = !isSoftwareGl;
    group.add(wallMain);

    // Timber crossbeam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(obs.width * 1.06, 0.22, 2.3), trimMat);
    beam.position.y = obs.height * 0.78;
    group.add(beam);

    // 3 Crenellations / Merlons on top
    for (const zOff of [-0.7, 0, 0.7]) {
      const merlon = new THREE.Mesh(
        new THREE.BoxGeometry(obs.width * 0.92, obs.height * 0.2, 0.48),
        masonryMat
      );
      merlon.position.set(0, obs.height * 0.91, zOff);
      group.add(merlon);
    }
  }

  return {
    id: obs.id,
    group,
    flashTimer: 0,
    materials,
    baseColors,
  };
}
