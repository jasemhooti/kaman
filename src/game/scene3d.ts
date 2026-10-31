import * as THREE from 'three';
import {
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
  cape: THREE.Mesh;
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
 * Rich multi-layered procedural texture generator for terrain strata, wood staves, and stone masonry
 */
export function createProceduralGrainTexture(
  renderer: THREE.WebGLRenderer,
  baseHex: string,
  accentHex: string,
  isColorMap: boolean,
  pattern: 'terrain' | 'wood' | 'stone' = 'terrain'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, baseHex);
  grad.addColorStop(0.5, accentHex);
  grad.addColorStop(1, baseHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  if (pattern === 'stone') {
    // Ashlar stone block courses
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 3;
    const rows = 8;
    const rowH = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
      const cols = 4;
      const colW = 256 / cols;
      const offset = (r % 2) * (colW * 0.5);
      for (let c = 0; c <= cols; c++) {
        const x = (c * colW + offset) % 256;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + rowH);
        ctx.stroke();
      }
    }
  } else if (pattern === 'wood') {
    // Vertical stave planks & wood grain fibers
    ctx.strokeStyle = 'rgba(20, 10, 4, 0.42)';
    ctx.lineWidth = 2;
    for (let x = 0; x < 256; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
  }

  // Fine surface micro-relief noise
  ctx.fillStyle = accentHex;
  for (let i = 0; i < 420; i++) {
    const x = (i * 53) % 256;
    const y = (i * 97) % 256;
    const w = 6 + (i % 18);
    const h = 2 + (i % 5);
    ctx.globalAlpha = 0.1 + (i % 5) * 0.035;
    ctx.fillRect(x, y, w, h);
  }

  // Highlight flecks
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 160; i++) {
    const x = (i * 71) % 256;
    const y = (i * 43) % 256;
    ctx.globalAlpha = 0.05 + (i % 3) * 0.025;
    ctx.fillRect(x, y, 4 + (i % 8), 2);
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
 * Procedural Atmospheric Sky Dome with Sunset/Twilight Horizon Glow & Sun/Moon Disc
 */
export function createSkyDome(): {
  domeGroup: THREE.Group;
  updateSkyWeather: (weather: WeatherType, elapsed: number) => void;
} {
  const domeGroup = new THREE.Group();

  const vertexShader = `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;

  const fragmentShader = `
    uniform vec3 topColor;
    uniform vec3 midColor;
    uniform vec3 bottomColor;
    uniform vec3 sunDir;
    uniform vec3 sunColor;
    varying vec3 vWorldPosition;

    void main() {
      vec3 dir = normalize(vWorldPosition);
      float h = clamp(dir.y, 0.0, 1.0);
      vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.28, h));
      col = mix(col, topColor, smoothstep(0.28, 0.85, h));

      // Sun / Moon atmospheric corona glow
      float sunAmt = max(dot(dir, normalize(sunDir)), 0.0);
      col += sunColor * pow(sunAmt, 12.0) * 0.48;
      col += sunColor * smoothstep(0.996, 0.9995, sunAmt) * 1.35;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const uniforms = {
    topColor: { value: new THREE.Color(0x0b132b) },
    midColor: { value: new THREE.Color(0x1e2952) },
    bottomColor: { value: new THREE.Color(0xd97706) },
    sunDir: { value: new THREE.Vector3(0.2, 0.34, -0.9) },
    sunColor: { value: new THREE.Color(0xfbbf24) },
  };

  const skyGeo = new THREE.SphereGeometry(210, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  domeGroup.add(skyMesh);

  const updateSkyWeather = (weather: WeatherType, elapsed: number) => {
    const pulse = Math.sin(elapsed * 0.5) * 0.03;
    if (weather === 'dust') {
      uniforms.topColor.value.setHex(0x271712);
      uniforms.midColor.value.setHex(0x7c2d12);
      uniforms.bottomColor.value.setHex(0xf59e0b);
      uniforms.sunColor.value.setHex(0xfef08a);
    } else if (weather === 'rain') {
      uniforms.topColor.value.setHex(0x060b16);
      uniforms.midColor.value.setHex(0x1e293b);
      uniforms.bottomColor.value.setHex(0x38bdf8);
      uniforms.sunColor.value.setHex(0x93c5fd);
    } else {
      uniforms.topColor.value.setHex(0x091128);
      uniforms.midColor.value.setHex(0x26234e);
      uniforms.bottomColor.value.setHex(0xea580c);
      uniforms.sunColor.value.setHex(0xfde047);
    }
    uniforms.sunDir.value.set(0.15 + pulse, 0.32, -0.92);
  };

  return { domeGroup, updateSkyWeather };
}

/**
 * Create a 3D Volumetric Low-Poly Cloud Cluster
 */
export function createCloudCluster(): THREE.Group {
  const group = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.92,
    metalness: 0.02,
    transparent: true,
    opacity: 0.82,
  });

  const puffs = [
    { x: 0, y: 0, z: 0, sx: 2.8, sy: 1.3, sz: 1.6 },
    { x: -1.8, y: -0.2, z: 0.2, sx: 1.9, sy: 1.0, sz: 1.3 },
    { x: 1.9, y: -0.15, z: -0.1, sx: 2.1, sy: 1.1, sz: 1.4 },
    { x: 0.6, y: 0.55, z: 0.1, sx: 1.7, sy: 1.0, sz: 1.2 },
  ];

  const geo = new THREE.DodecahedronGeometry(1, 1);
  for (const p of puffs) {
    const m = new THREE.Mesh(geo, cloudMat);
    m.position.set(p.x, p.y, p.z);
    m.scale.set(p.sx, p.sy, p.sz);
    group.add(m);
  }
  return group;
}

/**
 * Create a flickering 3D Fire Brazier / Torch stand placed near each archer bastion
 */
export function createTorchBrazier(): {
  group: THREE.Group;
  flameMesh: THREE.Mesh;
} {
  const group = new THREE.Group();
  const ironMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.4,
    metalness: 0.85,
  });
  const coalMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0xea580c,
    emissiveIntensity: 1.2,
    roughness: 0.6,
  });
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xfde047,
    emissive: 0xf97316,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });

  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 1.15, 8), ironMat);
  stand.position.y = 0.575;
  group.add(stand);

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.16, 0.28, 10), ironMat);
  bowl.position.y = 1.18;
  group.add(bowl);

  const coals = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), coalMat);
  coals.scale.y = 0.45;
  coals.position.y = 1.28;
  group.add(coals);

  const flameMesh = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.72, 7), flameMat);
  flameMesh.position.y = 1.62;
  group.add(flameMesh);

  return { group, flameMesh };
}

/**
 * Create a tall Battle Standard / War Banner that waves with windSpeed
 */
export function createWarBanner(isPlayer1: boolean): {
  group: THREE.Group;
  clothMesh: THREE.Mesh;
} {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.3,
    metalness: 0.8,
  });
  const clothMat = new THREE.MeshStandardMaterial({
    color: isPlayer1 ? 0x2563eb : 0xdc2626,
    emissive: isPlayer1 ? 0x1e3a8a : 0x7f1d1d,
    emissiveIntensity: 0.25,
    roughness: 0.65,
    side: THREE.DoubleSide,
  });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.6, 8), poleMat);
  pole.position.y = 1.8;
  group.add(pole);

  const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), poleMat);
  finial.position.y = 3.68;
  group.add(finial);

  const clothGeo = new THREE.PlaneGeometry(1.15, 0.62, 6, 2);
  clothGeo.translate(0.58, 0, 0);
  const clothMesh = new THREE.Mesh(clothGeo, clothMat);
  clothMesh.position.set(0, 3.18, 0);
  group.add(clothMesh);

  return { group, clothMesh };
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
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.26)');
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
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.018;
  return mesh;
}

/**
 * Build a high-visibility 3D Arrow mesh group (wooden shaft, blazing steel/fire tip, 3 fletching feathers)
 */
export function createArrowMesh(): THREE.Group {
  const group = new THREE.Group();

  // Wooden shaft along +X axis
  const shaftGeo = new THREE.CylinderGeometry(0.026, 0.026, 1.22, 8);
  shaftGeo.rotateZ(-Math.PI / 2);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0xe2c799,
    roughness: 0.55,
    metalness: 0.12,
  });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  group.add(shaft);

  // Broadhead steel tip + glowing ember ring at +0.66m
  const tipGeo = new THREE.ConeGeometry(0.068, 0.26, 6);
  tipGeo.rotateZ(-Math.PI / 2);
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.35,
    roughness: 0.18,
    metalness: 0.92,
  });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.x = 0.66;
  group.add(tip);

  // Glowing tail fletching feathers at -0.52m
  const featherGeo = new THREE.BoxGeometry(0.26, 0.11, 0.018);
  const featherMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.65,
    roughness: 0.3,
  });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(featherGeo, featherMat);
    f.position.x = -0.5;
    f.rotation.x = (i * Math.PI * 2) / 3;
    group.add(f);
  }

  return group;
}

/**
 * Build a 12-part composite 3D Archer model with articulated limbs, royal cape, Persian helmet, quiver, bow & ragdoll support
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

  root.add(createContactShadowDisc(1.05));

  const primaryArmorHex = isPlayer1 ? 0x2563eb : 0xdc2626;
  const trimBrassHex = isPlayer1 ? 0xfbbf24 : 0xf59e0b;
  const clothHex = isPlayer1 ? 0x0f172a : 0x18181b;
  const capeHex = isPlayer1 ? 0x1d4ed8 : 0x991b1b;
  const leatherHex = 0x5c3a21;
  const skinHex = 0xd6a77a;

  const armorMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: primaryArmorHex,
      roughness: 0.28,
      metalness: 0.58,
    })
  );
  const brassMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: trimBrassHex,
      roughness: 0.18,
      metalness: 0.9,
    })
  );
  const clothMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: clothHex,
      roughness: 0.8,
      metalness: 0.08,
    })
  );
  const capeMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: capeHex,
      roughness: 0.72,
      metalness: 0.05,
      side: THREE.DoubleSide,
    })
  );
  const leatherMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: leatherHex,
      roughness: 0.68,
      metalness: 0.12,
    })
  );
  const skinMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: skinHex,
      roughness: 0.6,
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

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.115, 0.52, 10), clothMat);
    thigh.position.y = -0.25;
    thigh.castShadow = !isSoftwareGl;
    legGroup.add(thigh);

    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.44, 10), leatherMat);
    boot.position.y = -0.68;
    boot.castShadow = !isSoftwareGl;
    legGroup.add(boot);

    const kneeGuard = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 8), brassMat);
    kneeGuard.position.set(0.055, -0.46, 0);
    legGroup.add(kneeGuard);

    return legGroup;
  };

  const leftLeg = makeLeg(0.16);
  const rightLeg = makeLeg(-0.16);
  hips.add(leftLeg);
  hips.add(rightLeg);

  // 3: Torso Cuirass, Tassets & Belt
  const torso = new THREE.Group();
  hips.add(torso);

  const chestMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.235, 0.84, 12), armorMat);
  chestMesh.position.y = 0.42;
  chestMesh.castShadow = !isSoftwareGl;
  torso.add(chestMesh);

  // Golden Chest Plate Medallion
  const chestEmblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), brassMat);
  chestEmblem.position.set(0.24, 0.52, 0);
  torso.add(chestEmblem);

  const beltMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.13, 12), leatherMat);
  beltMesh.position.y = 0.08;
  torso.add(beltMesh);

  const buckleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.19), brassMat);
  buckleMesh.position.set(0.24, 0.08, 0);
  torso.add(buckleMesh);

  // 4: Flowing Back Cape
  const capeGeo = new THREE.PlaneGeometry(0.55, 1.15, 2, 4);
  capeGeo.translate(0, -0.55, 0);
  const cape = new THREE.Mesh(capeGeo, capeMat);
  cape.position.set(-0.24, 0.78, 0);
  cape.rotation.y = Math.PI / 2;
  cape.rotation.x = 0.22;
  torso.add(cape);

  // 5: Layered Pauldrons (Shoulder Guards)
  for (const side of [-1, 1]) {
    const pauldron = new THREE.Mesh(
      new THREE.SphereGeometry(0.175, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
      brassMat
    );
    pauldron.position.set(0, 0.78, side * 0.29);
    torso.add(pauldron);
  }

  // 6: Back Quiver with Feathered Arrows
  const quiverGroup = new THREE.Group();
  quiverGroup.position.set(-0.22, 0.52, -0.19);
  quiverGroup.rotation.z = 0.32;
  const quiverTube = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.56, 10), leatherMat);
  quiverGroup.add(quiverTube);
  for (let i = 0; i < 3; i++) {
    const qShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 6), brassMat);
    qShaft.position.set((i - 1) * 0.03, 0.28, (i % 2) * 0.02);
    quiverGroup.add(qShaft);
  }
  torso.add(quiverGroup);

  // 7: Articulated Head + Persian/Medieval Spangenhelm + Crown Rim + Plume
  const head = new THREE.Group();
  head.position.y = 0.92;
  torso.add(head);

  const headSphere = new THREE.Mesh(new THREE.SphereGeometry(0.215, 14, 14), skinMat);
  headSphere.position.y = 0.21;
  headSphere.castShadow = !isSoftwareGl;
  head.add(headSphere);

  const helmetRim = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.07, 14), brassMat);
  helmetRim.position.y = 0.24;
  head.add(helmetRim);

  const helmetDome = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.36, 14), brassMat);
  helmetDome.position.y = 0.38;
  helmetDome.castShadow = !isSoftwareGl;
  head.add(helmetDome);

  const nasalBar = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.19, 0.045), brassMat);
  nasalBar.position.set(0.215, 0.24, 0);
  head.add(nasalBar);

  const plumeMat = registerMat(
    new THREE.MeshStandardMaterial({
      color: isPlayer1 ? 0x38bdf8 : 0xf87171,
      emissive: isPlayer1 ? 0x0284c7 : 0xdc2626,
      emissiveIntensity: 0.25,
      roughness: 0.45,
      metalness: 0.1,
    })
  );
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.36, 8), plumeMat);
  plume.position.set(-0.08, 0.56, 0);
  plume.rotation.z = 0.65;
  head.add(plume);

  // 8: Articulated Bow Arm + Composite Recurve Bow
  const bowArm = new THREE.Group();
  bowArm.position.set(0.06, 0.68, 0.24);
  torso.add(bowArm);

  const foreArm = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.068, 0.52, 8), skinMat);
  foreArm.rotation.z = -Math.PI / 2;
  foreArm.position.x = 0.26;
  bowArm.add(foreArm);

  const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.078, 0.24, 8), brassMat);
  bracer.rotation.z = -Math.PI / 2;
  bracer.position.x = 0.34;
  bowArm.add(bracer);

  const bowCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.46, 0.72, 0),
    new THREE.Vector3(0.58, 0.47, 0),
    new THREE.Vector3(0.66, 0.19, 0),
    new THREE.Vector3(0.59, 0.0, 0),
    new THREE.Vector3(0.66, -0.19, 0),
    new THREE.Vector3(0.58, -0.47, 0),
    new THREE.Vector3(0.46, -0.72, 0),
  ]);
  const bowGeo = new THREE.TubeGeometry(bowCurve, 24, 0.036, 8, false);
  const bowMesh = new THREE.Mesh(bowGeo, brassMat);
  bowArm.add(bowMesh);

  const bowGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.22, 8), leatherMat);
  bowGrip.position.set(0.59, 0, 0);
  bowArm.add(bowGrip);

  // 9: Dynamic Bowstring
  const bowStringPositions = new Float32Array([
    0.46, 0.72, 0,
    0.15, 0.0, 0,
    0.46, -0.72, 0,
  ]);
  const stringGeo = new THREE.BufferGeometry();
  stringGeo.setAttribute('position', new THREE.BufferAttribute(bowStringPositions, 3));
  const stringMat = new THREE.LineBasicMaterial({ color: 0xf8fafc });
  const bowString = new THREE.Line(stringGeo, stringMat);
  bowArm.add(bowString);

  // 10: Nocked Arrow inside the bow
  const nockedArrow = createArrowMesh();
  nockedArrow.position.set(0.32, 0, 0);
  bowArm.add(nockedArrow);

  // 11: Draw Arm
  const drawArm = new THREE.Group();
  drawArm.position.set(-0.04, 0.68, -0.24);
  torso.add(drawArm);
  const drawArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.068, 0.46, 8), armorMat);
  drawArmMesh.rotation.z = -Math.PI / 2;
  drawArmMesh.position.x = 0.2;
  drawArm.add(drawArmMesh);

  return {
    root,
    hips,
    torso,
    head,
    cape,
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
 * Update archer aim pose + cape wind flutter
 */
export function updateArcherPose(
  rig: ArcherRig,
  archer: ArcherState,
  isCurrentTurn: boolean,
  elapsedTime: number,
  windSpeed = 0
) {
  if (rig.ragdollActive) return;

  rig.root.position.set(archer.x, archer.y, 0);
  rig.root.scale.x = archer.facing;

  const breath = Math.sin(elapsedTime * 2.6 + archer.id * 1.7) * 0.025;
  rig.torso.position.y = breath;

  // Cape billows with wind and breathing
  rig.cape.rotation.x = 0.24 + Math.sin(elapsedTime * 4.2 + archer.id) * 0.08 + Math.abs(windSpeed) * 0.035;

  const targetRad = THREE.MathUtils.degToRad(archer.angleDeg);
  rig.bowArm.rotation.z = targetRad;
  rig.drawArm.rotation.z = targetRad * 0.85;
  rig.head.rotation.z = targetRad * 0.45;

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
  group.add(createContactShadowDisc(obs.width * 0.75));

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
        bumpMap: woodTex,
        bumpScale: 0.06,
        roughness: 0.72,
        metalness: 0.08,
      })
    );
    const ironMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.3,
        metalness: 0.85,
      })
    );

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(obs.width * 0.45, obs.width * 0.43, obs.height, 14),
      staveMat
    );
    body.position.y = obs.height * 0.5;
    body.castShadow = !isSoftwareGl;
    body.receiveShadow = !isSoftwareGl;
    group.add(body);

    for (const hRatio of [0.2, 0.5, 0.8]) {
      const hoop = new THREE.Mesh(
        new THREE.CylinderGeometry(obs.width * 0.47, obs.width * 0.47, 0.09, 14),
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
        bumpMap: stoneTex,
        bumpScale: 0.08,
        roughness: 0.82,
        metalness: 0.12,
      })
    );
    const crystalMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.45,
        roughness: 0.2,
        metalness: 0.5,
      })
    );

    const baseRock = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.width * 0.56, 1), rockMat);
    baseRock.scale.set(1.0, obs.height / (obs.width * 1.05), 0.92);
    baseRock.position.y = obs.height * 0.48;
    baseRock.castShadow = !isSoftwareGl;
    baseRock.receiveShadow = !isSoftwareGl;
    group.add(baseRock);

    const sideSpire = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.width * 0.35, 0), rockMat);
    sideSpire.position.set(obs.width * 0.28, obs.height * 0.28, 0.25);
    group.add(sideSpire);

    const crystalShard = new THREE.Mesh(new THREE.OctahedronGeometry(obs.width * 0.22, 0), crystalMat);
    crystalShard.scale.set(0.6, 1.6, 0.6);
    crystalShard.position.set(0, obs.height * 0.92, 0);
    group.add(crystalShard);
  } else {
    const masonryMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneTex,
        bumpMap: stoneTex,
        bumpScale: 0.08,
        roughness: 0.78,
        metalness: 0.14,
      })
    );
    const trimMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0xb45309,
        roughness: 0.55,
        metalness: 0.35,
      })
    );

    const wallMain = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width, obs.height * 0.82, 2.4),
      masonryMat
    );
    wallMain.position.y = obs.height * 0.41;
    wallMain.castShadow = !isSoftwareGl;
    wallMain.receiveShadow = !isSoftwareGl;
    group.add(wallMain);

    const beam = new THREE.Mesh(new THREE.BoxGeometry(obs.width * 1.08, 0.24, 2.5), trimMat);
    beam.position.y = obs.height * 0.78;
    group.add(beam);

    for (const zOff of [-0.75, 0, 0.75]) {
      const merlon = new THREE.Mesh(
        new THREE.BoxGeometry(obs.width * 0.94, obs.height * 0.22, 0.52),
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
