import * as THREE from 'three';
import type {
  BattlefieldConfig,
  BiomeType,
  DestructibleObstacle,
  ObstacleKind,
  SupplyCrate,
  TankModelSpec,
} from './physics';
import { seededRandom, terrainHeightAt } from './physics';

export interface TankRig {
  root: THREE.Group;
  hullGroup: THREE.Group;
  turretYawGroup: THREE.Group;
  turretMeshGroup: THREE.Group;
  barrelElevationGroup: THREE.Group;
  barrelRecoilGroup: THREE.Group;
  muzzleFlashMesh: THREE.Mesh;
  wheels: THREE.Mesh[];
  hitFlashTimer: number;
  recoilOffset: number;
  destroyed: boolean;
  turretBlownOff: boolean;
  flyingTurret: {
    mesh: THREE.Group;
    vx: number;
    vy: number;
    vz: number;
    rx: number;
    ry: number;
    rz: number;
  } | null;
}

export interface ObstacleRig {
  id: string;
  kind: ObstacleKind;
  group: THREE.Group;
  radarSpinner?: THREE.Object3D;
}

export interface CrateRig {
  id: string;
  kind: SupplyCrate['kind'];
  group: THREE.Group;
}

export interface PbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

function hash2D(ix: number, iy: number, seed = 1337): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;

  const aa = hash2D(x0, y0, seed);
  const ba = hash2D(x1, y0, seed);
  const ab = hash2D(x0, y1, seed);
  const bb = hash2D(x1, y1, seed);

  const lerpX1 = aa + u * (ba - aa);
  const lerpX2 = ab + u * (bb - ab);
  return lerpX1 + v * (lerpX2 - lerpX1);
}

function fbmTileable(u: number, v: number, octaves = 4, basePeriod = 8, seed = 101): number {
  let total = 0;
  let amp = 0.5;
  let maxAmp = 0;
  let freq = basePeriod;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(u * freq, v * freq, freq, seed + i * 97) * amp;
    maxAmp += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / maxAmp;
}

function parseHexToRgb(hexStr: string): [number, number, number] {
  const c = new THREE.Color(hexStr);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/**
 * Generates a realistic 3-Tone Military Camouflage & Weathered Rolled-Steel Armor PBR Texture Set.
 * Because the color is baked directly into the SRGB albedo map, we bind it with `color: 0xffffff`
 * so the tank armor looks bright, detailed, and realistic under sunlight and studio IBL.
 */
const camoCache = new Map<string, PbrTextureSet>();

export function createCamoArmorPbrSet(
  hullHex: string,
  turretHex: string,
  accentHex: string,
  maxAnisotropy = 4
): PbrTextureSet {
  const key = `${hullHex}_${turretHex}_${accentHex}`;
  const cached = camoCache.get(key);
  if (cached) return cached;

  const size = 256;
  const heightField = new Float32Array(size * size);

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const albedoCtx = albedoCanvas.getContext('2d')!;
  const albedoImg = albedoCtx.createImageData(size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext('2d')!;
  const roughImg = roughCtx.createImageData(size, size);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normalImg = normalCtx.createImageData(size, size);

  const [baseR, baseG, baseB] = parseHexToRgb(hullHex);
  const [darkR, darkG, darkB] = parseHexToRgb(turretHex);
  const [accR, accG, accB] = parseHexToRgb(accentHex);

  // Brighten base military paint slightly so it reads crisply outdoors
  const bR = Math.min(245, Math.round(baseR * 1.25 + 24));
  const bG = Math.min(245, Math.round(baseG * 1.25 + 24));
  const bB = Math.min(245, Math.round(baseB * 1.25 + 22));

  const dR = Math.min(220, Math.round(darkR * 0.92 + 10));
  const dG = Math.min(220, Math.round(darkG * 0.92 + 10));
  const dB = Math.min(220, Math.round(darkB * 0.92 + 10));

  // Secondary warm sand/olive camo blotch
  const sR = Math.min(245, Math.round((bR * 0.65 + accR * 0.35) + 28));
  const sG = Math.min(245, Math.round((bG * 0.65 + accG * 0.35) + 24));
  const sB = Math.min(235, Math.round((bB * 0.65 + accB * 0.35) + 14));

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const pIdx = idx * 4;

      const camoNoise1 = fbmTileable(u, v, 3, 4, 307);
      const camoNoise2 = fbmTileable(u + 0.37, v + 0.61, 3, 6, 619);
      const grain = fbmTileable(u, v, 4, 20, 911);

      // Armor plate weld seams & rivet lines
      const seamX = x % 64 === 0 || x % 64 === 1;
      const seamY = y % 64 === 0 || y % 64 === 1;
      const isSeam = seamX || seamY;
      const isEdgeBevel =
        x % 64 === 2 || x % 64 === 63 || y % 64 === 2 || y % 64 === 63;

      let r = bR;
      let g = bG;
      let b = bB;

      if (camoNoise1 > 0.56) {
        r = dR;
        g = dG;
        b = dB;
      } else if (camoNoise2 > 0.61) {
        r = sR;
        g = sG;
        b = sB;
      }

      const shade = 0.91 + grain * 0.18;
      r = Math.round(r * shade);
      g = Math.round(g * shade);
      b = Math.round(b * shade);

      let h = grain * 0.36;
      let rough = 112 + grain * 42;

      if (isSeam) {
        r = Math.round(r * 0.65);
        g = Math.round(g * 0.65);
        b = Math.round(b * 0.65);
        h -= 0.26;
        rough = 185;
      } else if (isEdgeBevel) {
        // Subtle metallic highlight along armor plate weld bevels
        r = Math.min(248, r + 18);
        g = Math.min(248, g + 18);
        b = Math.min(248, b + 20);
        h += 0.1;
        rough = 82;
      }

      heightField[idx] = Math.max(0, Math.min(1, h + 0.3));
      albedoImg.data[pIdx] = Math.max(0, Math.min(255, r));
      albedoImg.data[pIdx + 1] = Math.max(0, Math.min(255, g));
      albedoImg.data[pIdx + 2] = Math.max(0, Math.min(255, b));
      albedoImg.data[pIdx + 3] = 255;

      const rByte = Math.max(40, Math.min(245, Math.round(rough)));
      roughImg.data[pIdx] = rByte;
      roughImg.data[pIdx + 1] = rByte;
      roughImg.data[pIdx + 2] = rByte;
      roughImg.data[pIdx + 3] = 255;
    }
  }

  const normalStrength = 4.2;
  for (let y = 0; y < size; y++) {
    const ym1 = (y - 1 + size) % size;
    const yp1 = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm1 = (x - 1 + size) % size;
      const xp1 = (x + 1) % size;

      const tl = heightField[ym1 * size + xm1];
      const tc = heightField[ym1 * size + x];
      const tr = heightField[ym1 * size + xp1];
      const ml = heightField[y * size + xm1];
      const mr = heightField[y * size + xp1];
      const bl = heightField[yp1 * size + xm1];
      const bc = heightField[yp1 * size + x];
      const br = heightField[yp1 * size + xp1];

      const dX = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const dY = bl + 2 * bc + br - (tl + 2 * tc + tr);

      let nx = -dX * normalStrength;
      let ny = -dY * normalStrength;
      let nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const pIdx = (y * size + x) * 4;
      normalImg.data[pIdx] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImg.data[pIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImg.data[pIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalImg.data[pIdx + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);
  normalCtx.putImageData(normalImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(2, 2);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2, 2);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = maxAnisotropy;

  const result = { map, normalMap, roughnessMap };
  camoCache.set(key, result);
  return result;
}

/**
 * Generates high-resolution 512x512 PBR Albedo, Normal Map, and Roughness Map for Open-World terrain & concrete.
 */
export function createPbrTextureSet(
  kind: 'desert' | 'snow' | 'industrial' | 'volcanic' | 'night' | 'steel' | 'concrete',
  repeatX = 24,
  repeatY = 24,
  maxAnisotropy = 4
): PbrTextureSet {
  const size = 256;
  const heightField = new Float32Array(size * size);

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const albedoCtx = albedoCanvas.getContext('2d')!;
  const albedoImg = albedoCtx.createImageData(size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext('2d')!;
  const roughImg = roughCtx.createImageData(size, size);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normalImg = normalCtx.createImageData(size, size);

  const palette: Record<
    typeof kind,
    { r1: number; g1: number; b1: number; r2: number; g2: number; b2: number; baseRough: number }
  > = {
    desert: { r1: 224, g1: 174, b1: 112, r2: 172, g2: 122, b2: 68, baseRough: 205 },
    snow: { r1: 242, g1: 248, b1: 255, r2: 168, g2: 188, b2: 214, baseRough: 160 },
    industrial: { r1: 124, g1: 132, b1: 142, r2: 74, g2: 82, b2: 92, baseRough: 185 },
    volcanic: { r1: 96, g1: 84, b1: 82, r2: 46, g2: 38, b2: 38, baseRough: 215 },
    night: { r1: 84, g1: 102, b1: 126, r2: 44, g2: 56, b2: 76, baseRough: 190 },
    steel: { r1: 210, g1: 216, b1: 224, r2: 142, g2: 150, b2: 160, baseRough: 110 },
    concrete: { r1: 168, g1: 172, b1: 178, r2: 108, g2: 112, b2: 118, baseRough: 210 },
  };

  const pal = palette[kind];

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;

      const nLarge = fbmTileable(u, v, 4, 6, 101);
      const nFine = fbmTileable(u, v, 3, 24, 503);

      let h = nLarge * 0.65 + nFine * 0.35;
      if (kind === 'desert') {
        const ripple =
          Math.sin((v * 14 + u * 2 + nLarge * 0.85) * Math.PI * 2) * 0.5 + 0.5;
        h = h * 0.52 + ripple * 0.48;
      } else if (kind === 'concrete') {
        const pit = nFine < 0.3 ? -0.22 : 0;
        h = Math.max(0, Math.min(1, h + pit));
      }

      heightField[idx] = h;

      const mix = Math.max(0, Math.min(1, h * 0.9 + (nFine - 0.5) * 0.35));
      const r = Math.round(pal.r2 + (pal.r1 - pal.r2) * mix);
      const g = Math.round(pal.g2 + (pal.g1 - pal.g2) * mix);
      const b = Math.round(pal.b2 + (pal.b1 - pal.b2) * mix);

      const pIdx = idx * 4;
      albedoImg.data[pIdx] = r;
      albedoImg.data[pIdx + 1] = g;
      albedoImg.data[pIdx + 2] = b;
      albedoImg.data[pIdx + 3] = 255;

      const roughVal = Math.max(
        45,
        Math.min(250, Math.round(pal.baseRough + (0.5 - h) * 65))
      );
      roughImg.data[pIdx] = roughVal;
      roughImg.data[pIdx + 1] = roughVal;
      roughImg.data[pIdx + 2] = roughVal;
      roughImg.data[pIdx + 3] = 255;
    }
  }

  const normalStrength = kind === 'desert' ? 5.2 : 4.2;
  for (let y = 0; y < size; y++) {
    const ym1 = (y - 1 + size) % size;
    const yp1 = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm1 = (x - 1 + size) % size;
      const xp1 = (x + 1) % size;

      const tl = heightField[ym1 * size + xm1];
      const tc = heightField[ym1 * size + x];
      const tr = heightField[ym1 * size + xp1];
      const ml = heightField[y * size + xm1];
      const mr = heightField[y * size + xp1];
      const bl = heightField[yp1 * size + xm1];
      const bc = heightField[yp1 * size + x];
      const br = heightField[yp1 * size + xp1];

      const dX = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const dY = bl + 2 * bc + br - (tl + 2 * tc + tr);

      let nx = -dX * normalStrength;
      let ny = -dY * normalStrength;
      let nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const pIdx = (y * size + x) * 4;
      normalImg.data[pIdx] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImg.data[pIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImg.data[pIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalImg.data[pIdx + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedoImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);
  normalCtx.putImageData(normalImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeatX, repeatY);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeatX, repeatY);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = maxAnisotropy;

  return { map, normalMap, roughnessMap };
}

// Soft radial contact shadow texture shared by all tanks and vehicles
let sharedContactShadowTex: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture {
  if (sharedContactShadowTex) return sharedContactShadowTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.65, 'rgba(0, 0, 0, 0.35)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  sharedContactShadowTex = new THREE.CanvasTexture(c);
  return sharedContactShadowTex;
}

/**
 * Builds a Hyper-Realistic 60+ Part 3D Main Battle Tank (MBT) with 3-Tone Military Camouflage,
 * Studio IBL Metallic Reflections, Contact Shadow Grounding, ERA Reactive Armor, Dual Roadwheels,
 * Suspension Arms, Smoke Launchers, CITV Thermal Sight, .50 Cal Roof MG, and Bore Evacuator.
 *
 * Note: Inside `hullGroup`, the tank is built facing `+X` (`localFacing = 1`), and `hullGroup.rotation.y`
 * rotates the entire tank smoothly across all 360 degrees in the Open World!
 */
export function createTankRig(
  model: TankModelSpec,
  facing: 1 | -1,
  maxAnisotropy = 4
): TankRig {
  const root = new THREE.Group();
  root.scale.setScalar(model.scale);

  // Soft Radial Contact Shadow Plane directly beneath tank tracks
  const contactShadowGeo = new THREE.PlaneGeometry(5.6, 3.8);
  contactShadowGeo.rotateX(-Math.PI / 2);
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.65,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const contactShadowMesh = new THREE.Mesh(contactShadowGeo, contactShadowMat);
  contactShadowMesh.position.y = 0.02;
  root.add(contactShadowMesh);

  const hullGroup = new THREE.Group();
  // Initial orientation based on facing (+X = 0, -X = PI)
  hullGroup.rotation.y = facing === 1 ? 0 : Math.PI;
  root.add(hullGroup);

  const camoMaps = createCamoArmorPbrSet(
    model.hullColor,
    model.turretColor,
    model.accentColor,
    maxAnisotropy
  );

  // Color is 0xffffff because the tank's 3-tone camo colors are baked into camoMaps.map!
  const hullMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: camoMaps.map,
    normalMap: camoMaps.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: camoMaps.roughnessMap,
    roughness: 0.48,
    metalness: 0.42,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.35,
  });

  const turretMat = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    map: camoMaps.map,
    normalMap: camoMaps.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: camoMaps.roughnessMap,
    roughness: 0.42,
    metalness: 0.48,
    clearcoat: 0.32,
    clearcoatRoughness: 0.28,
    envMapIntensity: 1.45,
  });

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(model.accentColor),
    normalMap: camoMaps.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.32,
    metalness: 0.68,
    clearcoat: 0.4,
    envMapIntensity: 1.4,
  });

  const gunmetalMat = new THREE.MeshPhysicalMaterial({
    color: 0x3f4756,
    normalMap: camoMaps.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.3,
    metalness: 0.82,
    clearcoat: 0.3,
    envMapIntensity: 1.5,
  });

  const trackSteelMat = new THREE.MeshStandardMaterial({
    color: 0x262930,
    normalMap: camoMaps.normalMap,
    roughness: 0.68,
    metalness: 0.62,
  });

  const rubberRimMat = new THREE.MeshStandardMaterial({
    color: 0x181a1f,
    roughness: 0.88,
    metalness: 0.1,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.14,
    metalness: 0.94,
    envMapIntensity: 1.6,
  });

  const wheels: THREE.Mesh[] = [];
  const f = 1; // Local forward inside hullGroup is always +X

  // ============================================================================
  // 1. CONTINUOUS TRACK ASSEMBLIES, SUSPENSION ARMS, DUAL ROADWHEELS & SPROCKETS
  // ============================================================================
  const wheelXOffsets = [-1.62, -0.97, -0.32, 0.32, 0.97, 1.62];
  const rimGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.18, 24);
  rimGeo.rotateX(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.2, 20);
  discGeo.rotateX(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.24, 14);
  hubGeo.rotateX(Math.PI / 2);

  for (const sideZ of [-1.22, 1.22]) {
    const zSign = Math.sign(sideZ);

    const upperRun = new THREE.Mesh(new THREE.BoxGeometry(3.95, 0.11, 0.54), trackSteelMat);
    upperRun.position.set(0, 0.72, sideZ);
    upperRun.castShadow = true;
    upperRun.receiveShadow = true;
    hullGroup.add(upperRun);

    const lowerRun = new THREE.Mesh(new THREE.BoxGeometry(3.45, 0.11, 0.54), trackSteelMat);
    lowerRun.position.set(0, 0.06, sideZ);
    lowerRun.castShadow = true;
    lowerRun.receiveShadow = true;
    hullGroup.add(lowerRun);

    // 14 Grouser Track Cleats per side
    const cleatGeo = new THREE.BoxGeometry(0.14, 0.04, 0.56);
    for (let c = -6; c <= 6; c++) {
      const cleat = new THREE.Mesh(cleatGeo, gunmetalMat);
      cleat.position.set(c * 0.27, 0.77, sideZ);
      hullGroup.add(cleat);
    }

    // Drive Sprocket & Front Idler
    for (const endX of [-1.96, 1.96]) {
      const sprocket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.33, 0.33, 0.48, 18).rotateX(Math.PI / 2),
        gunmetalMat
      );
      sprocket.position.set(endX, 0.48, sideZ);
      sprocket.castShadow = true;
      hullGroup.add(sprocket);
      wheels.push(sprocket);

      const cap = new THREE.Mesh(hubGeo, accentMat);
      cap.position.set(endX, 0.48, sideZ + zSign * 0.16);
      hullGroup.add(cap);
    }

    // 6 Dual Roadwheel Stations + Torsion Suspension Arms
    for (let wIdx = 0; wIdx < wheelXOffsets.length; wIdx++) {
      const wx = wheelXOffsets[wIdx];

      const swingArm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.14), gunmetalMat);
      swingArm.position.set(wx - 0.1, 0.42, sideZ - zSign * 0.16);
      swingArm.rotation.z = 0.28;
      hullGroup.add(swingArm);

      const wheelGroup = new THREE.Mesh(rimGeo, rubberRimMat);
      wheelGroup.position.set(wx, 0.36, sideZ + zSign * 0.09);
      wheelGroup.castShadow = true;

      const innerDisc = new THREE.Mesh(discGeo, hullMat);
      wheelGroup.add(innerDisc);

      const hubCap = new THREE.Mesh(hubGeo, accentMat);
      hubCap.position.z = zSign * 0.04;
      wheelGroup.add(hubCap);

      hullGroup.add(wheelGroup);
      wheels.push(wheelGroup);
    }

    // Return Rollers
    for (const rx of [-1.05, 0, 1.05]) {
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.36, 12).rotateX(Math.PI / 2),
        gunmetalMat
      );
      roller.position.set(rx, 0.66, sideZ);
      hullGroup.add(roller);
    }

    // 5 Segmented Armored Side Skirts (Chobham / Bazooka Plates)
    for (let s = 0; s < 5; s++) {
      const sx = -1.56 + s * 0.78;
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.34, 0.09), hullMat);
      skirt.position.set(sx, 0.68, sideZ + zSign * 0.27);
      skirt.castShadow = true;
      skirt.receiveShadow = true;
      hullGroup.add(skirt);

      const boltBar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.11), accentMat);
      boltBar.position.set(sx, 0.82, sideZ + zSign * 0.27);
      hullGroup.add(boltBar);
    }
  }

  // ============================================================================
  // 2. SLOPED COMPOSITE ARMORED HULL, ERA BLOCKS, HEADLIGHTS & FUEL DRUMS
  // ============================================================================
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.15, 0.38);
  hullShape.lineTo(1.52, 0.38);
  hullShape.lineTo(2.26, 0.74); // Lower glacis
  hullShape.lineTo(1.36, 1.18); // Steeply sloped upper glacis
  hullShape.lineTo(-1.82, 1.18); // Hull roof & turret ring deck
  hullShape.lineTo(-2.22, 0.94); // Rear engine deck slope
  hullShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 2.04,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.06,
    bevelSegments: 3,
  });
  hullGeo.translate(0, 0, -1.02);
  const hullMesh = new THREE.Mesh(hullGeo, hullMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  hullGroup.add(hullMesh);

  // 8 Front Glacis Explosive Reactive Armor (ERA) Bricks
  const eraGeo = new THREE.BoxGeometry(0.42, 0.12, 0.44);
  for (const row of [0, 1]) {
    for (const colZ of [-0.72, -0.24, 0.24, 0.72]) {
      const eraBrick = new THREE.Mesh(eraGeo, turretMat);
      eraBrick.position.set(1.58 + row * 0.32, 1.08 - row * 0.15, colZ);
      eraBrick.rotation.z = -0.44;
      eraBrick.castShadow = true;
      hullGroup.add(eraBrick);
    }
  }

  // Driver's Armored Periscope Hood & Laser-Coated Vision Blocks
  const driverHood = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.56), gunmetalMat);
  driverHood.position.set(1.18, 1.24, 0);
  const visionGlass = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.08, 0.48),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  );
  visionGlass.position.set(0.02, 0.01, 0);
  driverHood.add(visionGlass);
  hullGroup.add(driverHood);

  // Dual Tactical LED Headlights with Protective Cages
  for (const lz of [-0.82, 0.82]) {
    const lampHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.18, 14).rotateZ(Math.PI / 2),
      gunmetalMat
    );
    lampHousing.position.set(2.04, 0.84, lz);
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfef9c3 })
    );
    lens.position.x = 0.07;
    lampHousing.add(lens);
    hullGroup.add(lampHousing);

    const towShackle = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.028, 8, 16),
      gunmetalMat
    );
    towShackle.position.set(2.22, 0.62, lz * 0.75);
    hullGroup.add(towShackle);
  }

  // Rear Engine Deck Cooling Louvres & Twin External Fuel Drums
  const engineGrille = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 1.54), gunmetalMat);
  engineGrille.position.set(-1.35, 1.2, 0);
  hullGroup.add(engineGrille);

  const drumGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.82, 18);
  drumGeo.rotateX(Math.PI / 2);
  for (const dz of [-0.56, 0.56]) {
    const drum = new THREE.Mesh(drumGeo, turretMat);
    drum.position.set(-2.28, 0.98, dz);
    drum.castShadow = true;
    hullGroup.add(drum);

    const strap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.08, 18).rotateX(Math.PI / 2),
      accentMat
    );
    strap.position.set(-2.28, 0.98, dz);
    hullGroup.add(strap);
  }

  // ============================================================================
  // 3. CAST COMPOSITE TURRET, WEDGE ARMOR, SMOKE LAUNCHERS, CITV & .50 CAL MG
  // ============================================================================
  const turretYawGroup = new THREE.Group();
  turretYawGroup.position.set(-0.08 * f, 1.22, 0);
  hullGroup.add(turretYawGroup);

  const turretMeshGroup = new THREE.Group();
  turretYawGroup.add(turretMeshGroup);

  const turretRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.98, 1.04, 0.16, 28),
    gunmetalMat
  );
  turretRing.position.y = 0.06;
  turretMeshGroup.add(turretRing);

  const tShape = new THREE.Shape();
  tShape.moveTo(-1.38, -0.78);
  tShape.lineTo(0.45, -0.94);
  tShape.lineTo(1.22, -0.58);
  tShape.lineTo(1.22, 0.58);
  tShape.lineTo(0.45, 0.94);
  tShape.lineTo(-1.38, 0.78);
  tShape.closePath();

  const mainTurretGeo = new THREE.ExtrudeGeometry(tShape, {
    depth: 0.58,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 3,
  });
  mainTurretGeo.rotateX(-Math.PI / 2);
  const mainTurretMesh = new THREE.Mesh(mainTurretGeo, turretMat);
  mainTurretMesh.position.y = 0.12;
  mainTurretMesh.castShadow = true;
  mainTurretMesh.receiveShadow = true;
  turretMeshGroup.add(mainTurretMesh);

  // Angled Composite Cheek Armor Wedges & 6 Smoke Grenade Launchers
  for (const cz of [-0.72, 0.72]) {
    const cheekWedge = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.48, 0.36), hullMat);
    cheekWedge.position.set(0.78, 0.42, cz);
    cheekWedge.rotation.y = cz > 0 ? -0.28 : 0.28;
    cheekWedge.castShadow = true;
    turretMeshGroup.add(cheekWedge);

    const cheekStripe = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.38), accentMat);
    cheekStripe.position.set(0.84, 0.42, cz);
    cheekStripe.rotation.y = cz > 0 ? -0.28 : 0.28;
    turretMeshGroup.add(cheekStripe);

    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.048, 0.28, 12),
        gunmetalMat
      );
      tube.position.set(0.28 - sIdx * 0.12, 0.4 + sIdx * 0.08, cz > 0 ? 0.98 : -0.98);
      tube.rotation.z = 0.35 + sIdx * 0.08;
      tube.rotation.y = cz > 0 ? -0.25 : 0.25;
      turretMeshGroup.add(tube);
    }
  }

  // Commander's Cupola Hatch & CITV Panoramic Thermal Sight
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.2, 20), gunmetalMat);
  cupola.position.set(-0.24, 0.76, -0.34);
  turretMeshGroup.add(cupola);

  const citvHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.28, 16), hullMat);
  citvHousing.position.set(0.22, 0.84, 0.36);
  const opticWindow = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.14, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x10b981 })
  );
  opticWindow.position.set(0.08, 0.02, 0);
  citvHousing.add(opticWindow);
  turretMeshGroup.add(citvHousing);

  // Roof-Mounted Heavy Machine Gun (.50 Cal / DShK on Pintle Mount)
  const mgGroup = new THREE.Group();
  mgGroup.position.set(-0.22, 0.9, -0.34);
  turretMeshGroup.add(mgGroup);

  const mgPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.26, 10), gunmetalMat);
  mgGroup.add(mgPost);

  const mgReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.12), gunmetalMat);
  mgReceiver.position.set(0.1, 0.14, 0);
  mgGroup.add(mgReceiver);

  const mgBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.032, 0.7, 10).rotateZ(Math.PI / 2),
    gunmetalMat
  );
  mgBarrel.position.set(0.56, 0.15, 0);
  mgGroup.add(mgBarrel);

  const mgAmmoBox = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.16), accentMat);
  mgAmmoBox.position.set(0.08, 0.1, -0.14);
  mgGroup.add(mgAmmoBox);

  // Dual Whip Antennas on Rear Turret Bustle
  for (const az of [-0.62, 0.62]) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.028, 1.55, 8), gunmetalMat);
    antenna.position.set(-1.38, 1.32, az);
    antenna.rotation.z = -0.08;
    turretMeshGroup.add(antenna);
  }

  // ============================================================================
  // 4. GUN MANTLET, THERMAL SHROUD, BORE EVACUATOR & SLOTTED MUZZLE BRAKE
  // ============================================================================
  const barrelElevationGroup = new THREE.Group();
  barrelElevationGroup.position.set(0.95, 0.42, 0);
  turretMeshGroup.add(barrelElevationGroup);

  const barrelRecoilGroup = new THREE.Group();
  barrelElevationGroup.add(barrelRecoilGroup);

  const mantletDrum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.82, 20).rotateX(Math.PI / 2),
    gunmetalMat
  );
  mantletDrum.castShadow = true;
  barrelRecoilGroup.add(mantletDrum);

  const zOffsets = model.barrelCount === 2 ? [-0.24, 0.24] : [0];
  for (const bz of zOffsets) {
    const shroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.155, 0.185, 0.95, 20).rotateZ(-Math.PI / 2),
      hullMat
    );
    shroud.position.set(0.48, 0, bz);
    shroud.castShadow = true;
    barrelRecoilGroup.add(shroud);

    const mainTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.135, 2.55, 24).rotateZ(-Math.PI / 2),
      gunmetalMat
    );
    mainTube.position.set(1.45, 0, bz);
    mainTube.castShadow = true;
    barrelRecoilGroup.add(mainTube);

    const fumeExtractor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.175, 0.175, 0.56, 20).rotateZ(-Math.PI / 2),
      turretMat
    );
    fumeExtractor.position.set(1.48, 0, bz);
    fumeExtractor.castShadow = true;
    barrelRecoilGroup.add(fumeExtractor);

    for (const collarX of [1.18, 1.78]) {
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.182, 0.182, 0.06, 20).rotateZ(-Math.PI / 2),
        accentMat
      );
      collar.position.set(collarX, 0, bz);
      barrelRecoilGroup.add(collar);
    }

    const muzzleBrake = new THREE.Mesh(
      new THREE.CylinderGeometry(0.165, 0.145, 0.36, 20).rotateZ(-Math.PI / 2),
      accentMat
    );
    muzzleBrake.position.set(2.68, 0, bz);
    muzzleBrake.castShadow = true;
    barrelRecoilGroup.add(muzzleBrake);

    const boreHole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.095, 0.38, 16).rotateZ(-Math.PI / 2),
      chromeMat
    );
    boreHole.position.set(2.69, 0, bz);
    barrelRecoilGroup.add(boreHole);
  }

  const flashGeo = new THREE.SphereGeometry(0.55, 14, 14);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0,
  });
  const muzzleFlashMesh = new THREE.Mesh(flashGeo, flashMat);
  muzzleFlashMesh.position.set(2.92, 0, 0);
  barrelRecoilGroup.add(muzzleFlashMesh);

  return {
    root,
    hullGroup,
    turretYawGroup,
    turretMeshGroup,
    barrelElevationGroup,
    barrelRecoilGroup,
    muzzleFlashMesh,
    wheels,
    hitFlashTimer: 0,
    recoilOffset: 0,
    destroyed: false,
    turretBlownOff: false,
    flyingTurret: null,
  };
}

/**
 * Updates 360-degree Open-World tank orientation (`hullYaw`), longitudinal slope (`slopeAngleRad`),
 * lateral roll (`rollAngleRad`), turret rotation (`turretYawRad`), and barrel elevation (`barrelAngleDeg`).
 */
export function updateTankPose(
  rig: TankRig,
  facing: 1 | -1,
  barrelAngleDeg: number,
  turretYawRad: number,
  slopeAngleRad: number,
  dt: number,
  hullYaw?: number,
  rollAngleRad = 0
): void {
  if (rig.destroyed) return;

  const targetHullYaw = typeof hullYaw === 'number' ? -hullYaw : facing === 1 ? 0 : Math.PI;
  // Shortest angular interpolation for 360-degree hull rotation
  const diffYaw = Math.atan2(
    Math.sin(targetHullYaw - rig.hullGroup.rotation.y),
    Math.cos(targetHullYaw - rig.hullGroup.rotation.y)
  );
  rig.hullGroup.rotation.y += diffYaw * (1 - Math.exp(-12 * dt));

  rig.hullGroup.rotation.z = THREE.MathUtils.lerp(
    rig.hullGroup.rotation.z,
    slopeAngleRad,
    1 - Math.exp(-10 * dt)
  );

  rig.hullGroup.rotation.x = THREE.MathUtils.lerp(
    rig.hullGroup.rotation.x,
    rollAngleRad,
    1 - Math.exp(-10 * dt)
  );

  const targetTurretY = -turretYawRad;
  const diffTurret = Math.atan2(
    Math.sin(targetTurretY - rig.turretYawGroup.rotation.y),
    Math.cos(targetTurretY - rig.turretYawGroup.rotation.y)
  );
  rig.turretYawGroup.rotation.y += diffTurret * (1 - Math.exp(-14 * dt));

  const elevRad = (Math.max(4, Math.min(75, barrelAngleDeg)) * Math.PI) / 180;
  rig.barrelElevationGroup.rotation.z = elevRad;

  if (rig.recoilOffset > 0.001) {
    rig.recoilOffset = Math.max(0, rig.recoilOffset - dt * 2.6);
    rig.barrelRecoilGroup.position.x = -rig.recoilOffset;
  } else {
    rig.barrelRecoilGroup.position.x = 0;
  }

  const flashMat = rig.muzzleFlashMesh.material as THREE.MeshBasicMaterial;
  if (flashMat.opacity > 0.01) {
    flashMat.opacity = Math.max(0, flashMat.opacity - dt * 8.5);
    const scale = 0.7 + flashMat.opacity * 0.9;
    rig.muzzleFlashMesh.scale.set(scale, scale, scale);
  }
}

export function triggerTankExplosion(rig: TankRig, scene: THREE.Scene): void {
  if (rig.turretBlownOff) return;
  rig.destroyed = true;
  rig.turretBlownOff = true;

  rig.hullGroup.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material = child.material.clone();
      child.material.color.setHex(0x27272a);
      child.material.roughness = 0.92;
    }
  });

  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  rig.turretMeshGroup.updateWorldMatrix(true, false);
  rig.turretMeshGroup.matrixWorld.decompose(worldPos, worldQuat, worldScale);

  rig.turretYawGroup.remove(rig.turretMeshGroup);
  rig.turretMeshGroup.position.copy(worldPos);
  rig.turretMeshGroup.quaternion.copy(worldQuat);
  rig.turretMeshGroup.scale.copy(worldScale);
  scene.add(rig.turretMeshGroup);

  rig.flyingTurret = {
    mesh: rig.turretMeshGroup,
    vx: (Math.random() - 0.5) * 6.5,
    vy: 12.5 + Math.random() * 3.5,
    vz: (Math.random() - 0.5) * 6.5,
    rx: (Math.random() - 0.5) * 7.0,
    ry: (Math.random() - 0.5) * 6.0,
    rz: (Math.random() - 0.5) * 8.0,
  };
}

export function stepFlyingTurret(
  rig: TankRig,
  dt: number,
  getGroundHeight: (x: number, z: number) => number
): void {
  const ft = rig.flyingTurret;
  if (!ft) return;

  ft.vy -= 9.81 * dt;
  ft.mesh.position.x += ft.vx * dt;
  ft.mesh.position.y += ft.vy * dt;
  ft.mesh.position.z += ft.vz * dt;

  ft.mesh.rotation.x += ft.rx * dt;
  ft.mesh.rotation.y += ft.ry * dt;
  ft.mesh.rotation.z += ft.rz * dt;

  const groundY = getGroundHeight(ft.mesh.position.x, ft.mesh.position.z) + 0.35;
  if (ft.mesh.position.y < groundY) {
    ft.mesh.position.y = groundY;
    ft.vy = Math.abs(ft.vy) * 0.28;
    ft.vx *= 0.62;
    ft.vz *= 0.62;
    ft.rx *= 0.5;
    ft.ry *= 0.5;
    ft.rz *= 0.5;
  }
}

/**
 * Creates a realistic fin-stabilized artillery shell mesh with glowing tracer tail.
 */
export function createShellMesh(colorHex = 0xf59e0b): THREE.Group {
  const group = new THREE.Group();

  const bodyGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.68, 16);
  bodyGeo.rotateZ(-Math.PI / 2);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.88,
    roughness: 0.2,
  });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  const noseGeo = new THREE.ConeGeometry(0.11, 0.42, 16);
  noseGeo.rotateZ(-Math.PI / 2);
  const noseMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.55,
    metalness: 0.7,
    roughness: 0.2,
  });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0.55, 0, 0);
  group.add(nose);

  const glowGeo = new THREE.SphereGeometry(0.25, 12, 12);
  const glowMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.72,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(-0.32, 0, 0);
  group.add(glow);

  return group;
}

/**
 * Creates a realistic Military Supply Crate with steel corner brackets and contact shadow.
 */
export function createSupplyCrateMesh(crate: SupplyCrate): CrateRig {
  const group = new THREE.Group();
  group.position.set(crate.x, crate.y + 0.55, crate.z);

  const bracketMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.4,
    metalness: 0.8,
  });

  if (crate.kind === 'heal') {
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.2,
    });
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

    const box = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 1.15), boxMat);
    box.castShadow = true;
    group.add(box);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.14, 1.22), bracketMat);
    frame.position.y = 0.42;
    group.add(frame);

    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.2, 1.19), crossMat);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 1.19), crossMat);
    group.add(hBar, vBar);
  } else {
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      roughness: 0.4,
      metalness: 0.55,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 0.4,
      roughness: 0.22,
      metalness: 0.9,
    });

    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.94, 1.1), boxMat);
    chest.castShadow = true;
    group.add(chest);

    const band = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.22, 1.16), goldMat);
    band.position.y = 0.14;
    group.add(band);
  }

  return {
    id: crate.id,
    kind: crate.kind,
    group,
  };
}

/**
 * Creates realistic multi-part 3D Open-World Military Structures:
 * - Watchtower (4-legged steel guard tower with observation cabin & searchlight)
 * - Radar Dome (reinforced concrete station with geodesic dome & rotating radar dish)
 * - Warehouse (large military hangar with arched roof & sliding steel doors)
 * - Bunker (octagonal pillbox with sandbags)
 * - Fuel Tank (pressurized hazard silo)
 * - Wall & Sculpted Rock Outcrop
 */
export function createObstacleRig(
  obs: DestructibleObstacle,
  concreteMaps: PbrTextureSet
): ObstacleRig {
  const group = new THREE.Group();
  group.position.set(obs.x, obs.y, obs.z);
  if (obs.rotationY) {
    group.rotation.y = obs.rotationY;
  }

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: concreteMaps.map,
    normalMap: concreteMaps.normalMap,
    roughnessMap: concreteMaps.roughnessMap,
    roughness: 0.82,
    metalness: 0.16,
  });

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x3f4756,
    roughness: 0.38,
    metalness: 0.82,
  });

  const oliveMetalMat = new THREE.MeshStandardMaterial({
    color: 0x4d5d43,
    normalMap: concreteMaps.normalMap,
    roughness: 0.58,
    metalness: 0.45,
  });

  let radarSpinner: THREE.Object3D | undefined;

  if (obs.kind === 'watchtower') {
    // 4-Legged Military Guard Watchtower with Sandbagged Observation Deck
    const legGeo = new THREE.CylinderGeometry(0.11, 0.15, obs.height * 0.72, 10);
    for (const lx of [-1.25, 1.25]) {
      for (const lz of [-1.25, 1.25]) {
        const leg = new THREE.Mesh(legGeo, steelMat);
        leg.position.set(lx, obs.height * 0.36, lz);
        leg.rotation.z = -lx * 0.06;
        leg.rotation.x = lz * 0.06;
        leg.castShadow = true;
        group.add(leg);
      }
    }

    // Cross-bracing girders
    for (const levelY of [2.1, 4.0]) {
      const braceX = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), steelMat);
      braceX.position.set(0, levelY, 1.15);
      const braceX2 = braceX.clone();
      braceX2.position.z = -1.15;
      group.add(braceX, braceX2);
    }

    // Observation Platform Deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.26, 3.4), concreteMat);
    deck.position.y = obs.height * 0.7;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    // Guard Cabin Walls
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.35, 2.7), oliveMetalMat);
    cabin.position.y = obs.height * 0.8;
    cabin.castShadow = true;
    group.add(cabin);

    // Window Cutout Visor Band
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(2.76, 0.42, 2.76),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.9 })
    );
    visor.position.y = obs.height * 0.83;
    group.add(visor);

    // Sloped Corrugated Roof + Searchlight Beacon
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.45, 0.95, 4), steelMat);
    roof.rotation.y = Math.PI * 0.25;
    roof.position.y = obs.height * 0.95;
    roof.castShadow = true;
    group.add(roof);

    const searchlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    searchlight.position.set(1.35, obs.height * 0.75, 1.35);
    group.add(searchlight);
  } else if (obs.kind === 'radar_dome') {
    // Reinforced Concrete Base + Geodesic Radome + Rotating Radar Dish
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 2.35, 2.1, 12),
      concreteMat
    );
    base.position.y = 1.05;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const domeMat = new THREE.MeshPhysicalMaterial({
      color: 0xe2e8f0,
      normalMap: concreteMaps.normalMap,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.32,
      metalness: 0.25,
      clearcoat: 0.4,
    });
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(1.85, 2), domeMat);
    dome.position.y = 2.85;
    dome.castShadow = true;
    group.add(dome);

    // Rotating Tactical Radar Array on Top
    const spinnerGroup = new THREE.Group();
    spinnerGroup.position.y = 4.85;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.7, 10), steelMat);
    spinnerGroup.add(mast);

    const dish = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.18), steelMat);
    dish.position.y = 0.35;
    dish.castShadow = true;
    spinnerGroup.add(dish);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    beacon.position.y = 0.78;
    spinnerGroup.add(beacon);

    group.add(spinnerGroup);
    radarSpinner = spinnerGroup;
  } else if (obs.kind === 'warehouse') {
    // Large Military Supply Hangar with Arched Roof & Heavy Doors
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width, obs.height * 0.68, obs.depth),
      oliveMetalMat
    );
    body.position.y = obs.height * 0.34;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const archRoof = new THREE.Mesh(
      new THREE.CylinderGeometry(
        obs.depth * 0.52,
        obs.depth * 0.52,
        obs.width * 1.02,
        18,
        1,
        false,
        0,
        Math.PI
      ).rotateZ(Math.PI / 2),
      steelMat
    );
    archRoof.position.y = obs.height * 0.65;
    archRoof.scale.set(1, 0.65, 1);
    archRoof.castShadow = true;
    group.add(archRoof);

    const hangarDoor = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width * 1.03, obs.height * 0.54, obs.depth * 0.52),
      steelMat
    );
    hangarDoor.position.y = obs.height * 0.27;
    group.add(hangarDoor);
  } else if (obs.kind === 'fuel_tank') {
    const tankMat = new THREE.MeshPhysicalMaterial({
      color: 0xdc2626,
      normalMap: concreteMaps.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.32,
      metalness: 0.58,
      clearcoat: 0.3,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.32,
      metalness: 0.5,
    });

    const radius = obs.width * 0.46;
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, obs.height * 0.82, 24),
      tankMat
    );
    cyl.position.y = obs.height * 0.45;
    cyl.castShadow = true;
    cyl.receiveShadow = true;
    group.add(cyl);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
      tankMat
    );
    dome.position.y = obs.height * 0.86;
    group.add(dome);

    const hazardBand = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, obs.height * 0.18, 24),
      stripeMat
    );
    hazardBand.position.y = obs.height * 0.52;
    group.add(hazardBand);

    const baseRing = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.08, radius * 1.12, 0.26, 20),
      steelMat
    );
    baseRing.position.y = 0.13;
    group.add(baseRing);
  } else if (obs.kind === 'bunker') {
    const r = obs.width * 0.56;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.94, r, obs.height * 0.78, 8),
      concreteMat
    );
    body.position.y = obs.height * 0.39;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.04, r * 1.0, obs.height * 0.2, 8),
      concreteMat
    );
    roof.position.y = obs.height * 0.85;
    roof.castShadow = true;
    group.add(roof);

    const slitFrame = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width * 0.65, 0.38, obs.depth * 0.92),
      steelMat
    );
    slitFrame.position.y = obs.height * 0.56;
    group.add(slitFrame);

    const sandbagMat = new THREE.MeshStandardMaterial({
      color: 0xc2a878,
      normalMap: concreteMaps.normalMap,
      roughness: 0.88,
      metalness: 0.05,
    });
    for (let s = -2; s <= 2; s++) {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), sandbagMat);
      bag.scale.set(1.4, 0.65, 0.9);
      bag.position.set(s * 0.42, obs.height * 0.98, 0.45);
      group.add(bag);
    }
  } else if (obs.kind === 'wall') {
    const lowerWall = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width * 1.05, obs.height * 0.45, obs.depth),
      concreteMat
    );
    lowerWall.position.y = obs.height * 0.225;
    lowerWall.castShadow = true;
    lowerWall.receiveShadow = true;
    group.add(lowerWall);

    const upperWall = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width * 0.78, obs.height * 0.55, obs.depth * 0.96),
      concreteMat
    );
    upperWall.position.y = obs.height * 0.72;
    upperWall.castShadow = true;
    group.add(upperWall);

    for (let rIdx = -1; rIdx <= 1; rIdx++) {
      const rebar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8),
        steelMat
      );
      rebar.position.set(0, obs.height + 0.18, rIdx * 0.85);
      rebar.rotation.z = rIdx * 0.18;
      group.add(rebar);
    }
  } else {
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xb89f82,
      map: concreteMaps.map,
      normalMap: concreteMaps.normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.88,
      metalness: 0.08,
    });
    const sculptRockGeo = (radius: number, seedOffset: number) => {
      const geo = new THREE.DodecahedronGeometry(radius, 1);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const noise =
          1 +
          0.16 * Math.sin(vx * 2.7 + seedOffset) * Math.cos(vy * 2.3 - seedOffset) +
          0.1 * Math.cos(vz * 3.1 + vx * 1.9);
        pos.setXYZ(i, vx * noise * 1.15, vy * noise * 0.82, vz * noise);
      }
      geo.computeVertexNormals();
      return geo;
    };
    const mainRock = new THREE.Mesh(sculptRockGeo(obs.width * 0.54, obs.x), rockMat);
    mainRock.position.y = obs.height * 0.38;
    mainRock.scale.set(1.12, obs.height / obs.width, 0.95);
    mainRock.castShadow = true;
    mainRock.receiveShadow = true;
    group.add(mainRock);

    const sideRock = new THREE.Mesh(sculptRockGeo(obs.width * 0.36, obs.x + 7.1), rockMat);
    sideRock.position.set(obs.width * 0.36, obs.height * 0.22, 0.32);
    sideRock.rotation.y = 0.8;
    sideRock.castShadow = true;
    sideRock.receiveShadow = true;
    group.add(sideRock);

    const leftRock = new THREE.Mesh(sculptRockGeo(obs.width * 0.28, obs.x - 4.3), rockMat);
    leftRock.position.set(-obs.width * 0.34, obs.height * 0.18, -0.24);
    leftRock.rotation.y = -0.6;
    leftRock.castShadow = true;
    group.add(leftRock);
  }

  return {
    id: obs.id,
    kind: obs.kind,
    group,
    radarSpinner,
  };
}

/**
 * Populates the 260m x 260m 3D Open World with a winding military highway/road network,
 * InstancedMesh biome trees (desert palms / alpine pines / industrial pylons), and scattered rocks.
 */
export function createOpenWorldScenery(
  arena: BattlefieldConfig,
  concreteMaps: PbrTextureSet
): THREE.Group {
  const sceneryGroup = new THREE.Group();
  const rng = seededRandom(arena.seed + 4099);

  // 1. Winding 3D Military Asphalt/Dirt Highway across the Open World
  const roadSegs = 90;
  const roadWidth = 5.4;
  const roadGeo = new THREE.PlaneGeometry(210, roadWidth, roadSegs, 2);
  roadGeo.rotateX(-Math.PI / 2);
  const rPos = roadGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rPos.count; i++) {
    const rx = rPos.getX(i);
    const localZ = rPos.getZ(i);
    const centerZ = 14 * Math.sin(rx * 0.03);
    const worldZ = centerZ + localZ;
    const worldY = terrainHeightAt(rx, arena, worldZ) + 0.04;
    rPos.setXYZ(i, rx, worldY, worldZ);
  }
  roadGeo.computeVertexNormals();

  const roadMat = new THREE.MeshStandardMaterial({
    color: arena.biome === 'desert' ? 0x856d4d : arena.biome === 'snow' ? 0x64748b : 0x334155,
    map: concreteMaps.map,
    normalMap: concreteMaps.normalMap,
    roughness: 0.88,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  sceneryGroup.add(roadMesh);

  // 2. Instanced Open-World Biome Trees (Trunks + Foliage Crowns)
  const treeCount = 72;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 3.6, 8);
  trunkGeo.translate(0, 1.8, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: arena.biome === 'industrial' ? 0x475569 : 0x5c4033,
    roughness: 0.88,
    metalness: arena.biome === 'industrial' ? 0.65 : 0.08,
  });

  const crownTier1Geo = new THREE.ConeGeometry(1.85, 2.35, 9);
  crownTier1Geo.translate(0, 2.65, 0);
  const crownTier2Geo = new THREE.ConeGeometry(1.42, 2.15, 9);
  crownTier2Geo.translate(0, 3.85, 0);
  const crownTier3Geo = new THREE.ConeGeometry(0.95, 1.85, 9);
  crownTier3Geo.translate(0, 4.95, 0);

  const crownMat = new THREE.MeshStandardMaterial({
    color:
      arena.biome === 'desert'
        ? 0x3f6212
        : arena.biome === 'snow'
          ? 0xcbd5e1
          : arena.biome === 'volcanic'
            ? 0x44403c
            : 0x365314,
    roughness: 0.85,
    metalness: 0.05,
  });

  const trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crownTier1Instanced = new THREE.InstancedMesh(crownTier1Geo, crownMat, treeCount);
  const crownTier2Instanced = new THREE.InstancedMesh(crownTier2Geo, crownMat, treeCount);
  const crownTier3Instanced = new THREE.InstancedMesh(crownTier3Geo, crownMat, treeCount);

  trunkInstanced.castShadow = true;
  crownTier1Instanced.castShadow = true;
  crownTier2Instanced.castShadow = true;
  crownTier3Instanced.castShadow = true;

  trunkInstanced.frustumCulled = false;
  crownTier1Instanced.frustumCulled = false;
  crownTier2Instanced.frustumCulled = false;
  crownTier3Instanced.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();
  let placedTrees = 0;

  for (let i = 0; i < 160 && placedTrees < treeCount; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 24 + rng() * 82;
    const tx = Math.cos(angle) * radius;
    const tz = Math.sin(angle) * radius;

    // Keep road and tank spawn clear
    const roadZ = 14 * Math.sin(tx * 0.03);
    if (Math.abs(tz - roadZ) < 7.5) continue;
    if (Math.abs(tz) < 12 && Math.abs(tx) < arena.distance * 0.65) continue;

    const ty = terrainHeightAt(tx, arena, tz);
    const s = 0.78 + rng() * 0.55;
    dummy.position.set(tx, ty - 0.1, tz);
    dummy.rotation.set((rng() - 0.5) * 0.1, rng() * Math.PI * 2, (rng() - 0.5) * 0.1);
    dummy.scale.set(s, s * (0.9 + rng() * 0.25), s);
    dummy.updateMatrix();

    trunkInstanced.setMatrixAt(placedTrees, dummy.matrix);
    crownTier1Instanced.setMatrixAt(placedTrees, dummy.matrix);
    crownTier2Instanced.setMatrixAt(placedTrees, dummy.matrix);
    crownTier3Instanced.setMatrixAt(placedTrees, dummy.matrix);

    const shade = 0.82 + rng() * 0.32;
    tintColor.setRGB(shade, shade, shade);
    crownTier1Instanced.setColorAt(placedTrees, tintColor);
    crownTier2Instanced.setColorAt(placedTrees, tintColor);
    crownTier3Instanced.setColorAt(placedTrees, tintColor);
    placedTrees++;
  }
  trunkInstanced.count = placedTrees;
  crownTier1Instanced.count = placedTrees;
  crownTier2Instanced.count = placedTrees;
  crownTier3Instanced.count = placedTrees;

  trunkInstanced.instanceMatrix.needsUpdate = true;
  crownTier1Instanced.instanceMatrix.needsUpdate = true;
  crownTier2Instanced.instanceMatrix.needsUpdate = true;
  crownTier3Instanced.instanceMatrix.needsUpdate = true;
  if (crownTier1Instanced.instanceColor) crownTier1Instanced.instanceColor.needsUpdate = true;
  if (crownTier2Instanced.instanceColor) crownTier2Instanced.instanceColor.needsUpdate = true;
  if (crownTier3Instanced.instanceColor) crownTier3Instanced.instanceColor.needsUpdate = true;

  sceneryGroup.add(
    trunkInstanced,
    crownTier1Instanced,
    crownTier2Instanced,
    crownTier3Instanced
  );

  // 3. Instanced Open-World Scattered Boulders & Rocks (95 instances)
  const rockCount = 95;
  const smallRockGeo = new THREE.DodecahedronGeometry(0.85, 1);
  const smallRockMat = new THREE.MeshStandardMaterial({
    color: arena.biome === 'desert' ? 0xb59469 : arena.biome === 'snow' ? 0x94a3b8 : 0x78716c,
    map: concreteMaps.map,
    normalMap: concreteMaps.normalMap,
    roughness: 0.88,
    metalness: 0.1,
  });
  const rockInstanced = new THREE.InstancedMesh(smallRockGeo, smallRockMat, rockCount);
  rockInstanced.castShadow = true;
  rockInstanced.receiveShadow = true;
  rockInstanced.frustumCulled = false;

  for (let i = 0; i < rockCount; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 14 + rng() * 94;
    const rx = Math.cos(angle) * radius;
    const rz = Math.sin(angle) * radius;
    const ry = terrainHeightAt(rx, arena, rz);
    const sx = 0.6 + rng() * 1.4;
    const sy = 0.45 + rng() * 0.85;
    const sz = 0.6 + rng() * 1.3;

    dummy.position.set(rx, ry + sy * 0.25, rz);
    dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    rockInstanced.setMatrixAt(i, dummy.matrix);
  }
  rockInstanced.instanceMatrix.needsUpdate = true;
  sceneryGroup.add(rockInstanced);

  return sceneryGroup;
}

/**
 * Creates a scorched 3D blast crater rim & rubble ring at the exact impact coordinates.
 */
export function createCraterDecalMesh(
  x: number,
  y: number,
  z: number,
  radius: number,
  depth: number,
  concreteMaps: PbrTextureSet
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, y, z);

  const scorchGeo = new THREE.RingGeometry(0.15, radius * 1.25, 24, 2);
  scorchGeo.rotateX(-Math.PI / 2);
  const scorchPos = scorchGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < scorchPos.count; i++) {
    const vx = scorchPos.getX(i);
    const vz = scorchPos.getZ(i);
    const r = Math.hypot(vx, vz);
    const u = Math.min(1.25, r / radius);
    const bowlY =
      u <= 1.0
        ? -depth * 0.42 * Math.cos(u * Math.PI * 0.5)
        : depth * 0.14 * Math.sin(((u - 1.0) / 0.25) * Math.PI);
    scorchPos.setY(i, bowlY + 0.03);
  }
  scorchGeo.computeVertexNormals();

  const scorchMat = new THREE.MeshStandardMaterial({
    color: 0x1c1917,
    normalMap: concreteMaps.normalMap,
    roughness: 0.95,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const scorchRing = new THREE.Mesh(scorchGeo, scorchMat);
  scorchRing.receiveShadow = true;
  group.add(scorchRing);

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x292524,
    normalMap: concreteMaps.normalMap,
    roughness: 0.92,
    metalness: 0.1,
  });
  const chunkCount = 8;
  for (let i = 0; i < chunkCount; i++) {
    const angle = (i / chunkCount) * Math.PI * 2 + (x * 1.3 + i);
    const dist = radius * (0.88 + (i % 3) * 0.12);
    const chunk = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.16 + (i % 3) * 0.07, 0),
      rockMat
    );
    chunk.position.set(Math.cos(angle) * dist, 0.08, Math.sin(angle) * dist);
    chunk.rotation.set(i * 0.7, i * 1.1, i * 0.4);
    chunk.scale.set(1.2, 0.7, 1.0);
    chunk.castShadow = true;
    group.add(chunk);
  }

  return group;
}

export function getBiomePalette(biome: BiomeType): {
  skyTop: string;
  skyHorizon: string;
  fogColor: number;
  groundColor: number;
  groundSubColor: number;
  sunColor: number;
  sunIntensity: number;
  ambientColor: number;
  weatherColor: number;
  turbidity: number;
  rayleigh: number;
  sunElevationDeg: number;
} {
  switch (biome) {
    case 'desert':
      return {
        skyTop: '#1d4ed8',
        skyHorizon: '#f59e0b',
        fogColor: 0xeab376,
        groundColor: 0xffffff,
        groundSubColor: 0xd9a066,
        sunColor: 0xfff7ed,
        sunIntensity: 2.6,
        ambientColor: 0xfde68a,
        weatherColor: 0xfde68a,
        turbidity: 8.5,
        rayleigh: 1.8,
        sunElevationDeg: 14,
      };
    case 'snow':
      return {
        skyTop: '#1e3a8a',
        skyHorizon: '#bae6fd',
        fogColor: 0xcbd5e1,
        groundColor: 0xffffff,
        groundSubColor: 0x94a3b8,
        sunColor: 0xf8fafc,
        sunIntensity: 2.3,
        ambientColor: 0xe0f2fe,
        weatherColor: 0xffffff,
        turbidity: 4.5,
        rayleigh: 1.4,
        sunElevationDeg: 22,
      };
    case 'industrial':
      return {
        skyTop: '#1e293b',
        skyHorizon: '#64748b',
        fogColor: 0x475569,
        groundColor: 0xffffff,
        groundSubColor: 0x64748b,
        sunColor: 0xe2e8f0,
        sunIntensity: 2.1,
        ambientColor: 0x94a3b8,
        weatherColor: 0x93c5fd,
        turbidity: 10.0,
        rayleigh: 2.2,
        sunElevationDeg: 18,
      };
    case 'volcanic':
      return {
        skyTop: '#3b0764',
        skyHorizon: '#ea580c',
        fogColor: 0x7c2d12,
        groundColor: 0xffffff,
        groundSubColor: 0x78716c,
        sunColor: 0xfb923c,
        sunIntensity: 2.4,
        ambientColor: 0xfdba74,
        weatherColor: 0xf97316,
        turbidity: 12.0,
        rayleigh: 3.2,
        sunElevationDeg: 9,
      };
    case 'night':
    default:
      return {
        skyTop: '#090d16',
        skyHorizon: '#1e293b',
        fogColor: 0x1e293b,
        groundColor: 0xffffff,
        groundSubColor: 0x475569,
        sunColor: 0x93c5fd,
        sunIntensity: 2.0,
        ambientColor: 0x60a5fa,
        weatherColor: 0x38bdf8,
        turbidity: 6.0,
        rayleigh: 0.9,
        sunElevationDeg: 8,
      };
  }
}
