import * as THREE from 'three';
import type {
  BiomeType,
  DestructibleObstacle,
  SupplyCrate,
  TankModelSpec,
} from './physics';

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
  kind: DestructibleObstacle['kind'];
  group: THREE.Group;
  flashTimer: number;
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

function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmNoise(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < 4; i++) {
    v += amp * smoothNoise(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return v;
}

/**
 * Generates a realistic 3-channel PBR Texture Set (Albedo Map + Tangent-Space Sobel Normal Map + Roughness Map).
 */
export function createPbrTextureSet(
  renderer: THREE.WebGLRenderer,
  baseHex: string,
  secondaryHex: string,
  style: 'terrain_sand' | 'terrain_snow' | 'terrain_rock' | 'armor' | 'concrete' | 'tracks'
): PbrTextureSet {
  const size = 256;
  const heightField = new Float32Array(size * size);

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const nCtx = normalCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const c1 = new THREE.Color(baseHex);
  const c2 = new THREE.Color(secondaryHex);

  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const nx = (x / size) * 8;
      const ny = (y / size) * 8;
      let h = fbmNoise(nx, ny);
      let mixFactor = h;
      let roughVal = 0.75;

      if (style === 'terrain_sand') {
        // Wind-blown sand ripples + fine mineral grain
        const ripple = Math.sin(ny * 6.5 + h * 3.2) * 0.5 + 0.5;
        const grain = hash2D(x, y) * 0.15;
        h = ripple * 0.65 + h * 0.35 + grain;
        mixFactor = ripple * 0.55 + h * 0.35;
        roughVal = 0.72 + (1 - ripple) * 0.18;
      } else if (style === 'terrain_snow') {
        const drift = Math.sin(nx * 4.2 + ny * 3.5 + h * 2.5) * 0.5 + 0.5;
        h = drift * 0.5 + h * 0.5;
        mixFactor = h * 0.6;
        roughVal = 0.45 + h * 0.35;
      } else if (style === 'terrain_rock') {
        const crag = Math.abs(fbmNoise(nx * 1.8, ny * 1.8) - 0.5) * 2.0;
        h = crag * 0.7 + hash2D(x, y) * 0.2;
        mixFactor = h;
        roughVal = 0.68 + h * 0.25;
      } else if (style === 'armor') {
        // Rolled steel armor micro-pitting + weld seams + camouflage blotches
        const camo = fbmNoise(nx * 0.55, ny * 0.55);
        const microPit = hash2D(x, y) * 0.08;
        const borderSeam =
          x < 5 || x > size - 6 || y < 5 || y > size - 6 || Math.abs(y - size / 2) < 3 ? -0.35 : 0;
        h = 0.5 + microPit + borderSeam;
        mixFactor = camo > 0.54 ? 0.78 : camo < 0.38 ? 0.15 : 0.45;
        roughVal = borderSeam < 0 ? 0.85 : 0.36 + microPit * 1.5;
      } else if (style === 'tracks') {
        const treadPos = y % 16;
        const isCleat = treadPos >= 3 && treadPos <= 11 && x > 14 && x < size - 14;
        h = isCleat ? 0.92 : 0.18;
        mixFactor = isCleat ? 0.85 : 0.2;
        roughVal = isCleat ? 0.42 : 0.82;
      } else {
        // Weathered reinforced concrete
        const seam = y % 32 < 2 || x % 64 < 2 ? -0.25 : 0;
        h = h * 0.75 + hash2D(x, y) * 0.2 + seam;
        mixFactor = h;
        roughVal = 0.78 + h * 0.18;
      }

      heightField[idx] = h;

      const r = Math.round(THREE.MathUtils.lerp(c1.r, c2.r, mixFactor) * 255);
      const g = Math.round(THREE.MathUtils.lerp(c1.g, c2.g, mixFactor) * 255);
      const b = Math.round(THREE.MathUtils.lerp(c1.b, c2.b, mixFactor) * 255);

      const pIdx = idx * 4;
      aImg.data[pIdx] = Math.max(0, Math.min(255, r));
      aImg.data[pIdx + 1] = Math.max(0, Math.min(255, g));
      aImg.data[pIdx + 2] = Math.max(0, Math.min(255, b));
      aImg.data[pIdx + 3] = 255;

      const rv = Math.max(0, Math.min(255, Math.round(roughVal * 255)));
      rImg.data[pIdx] = rv;
      rImg.data[pIdx + 1] = rv;
      rImg.data[pIdx + 2] = rv;
      rImg.data[pIdx + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  // Compute Tangent-Space Normal Map from heightField via Sobel filter
  const nImg = nCtx.createImageData(size, size);
  const bumpStrength = style === 'tracks' ? 4.5 : style === 'armor' ? 2.2 : 3.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm1 = (x - 1 + size) % size;
      const xp1 = (x + 1) % size;
      const ym1 = (y - 1 + size) % size;
      const yp1 = (y + 1) % size;

      const dX =
        heightField[y * size + xp1] -
        heightField[y * size + xm1];
      const dY =
        heightField[yp1 * size + x] -
        heightField[ym1 * size + x];

      let vx = -dX * bumpStrength;
      let vy = -dY * bumpStrength;
      let vz = 1.0;
      const len = Math.hypot(vx, vy, vz) || 1;
      vx /= len;
      vy /= len;
      vz /= len;

      const pIdx = (y * size + x) * 4;
      nImg.data[pIdx] = Math.round((vx * 0.5 + 0.5) * 255);
      nImg.data[pIdx + 1] = Math.round((vy * 0.5 + 0.5) * 255);
      nImg.data[pIdx + 2] = Math.round((vz * 0.5 + 0.5) * 255);
      nImg.data[pIdx + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);

  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = maxAniso;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAniso;

  return { map, normalMap, roughnessMap };
}

/**
 * Builds a high-detail 50+ part Realistic Main Battle Tank (MBT) Rig with:
 * - Normal-mapped rolled homogeneous steel & composite armor
 * - Moulded track loops with 28 individual 3D track grouser cleats, toothed drive sprockets,
 *   idler wheels, 12 dual rubber-rimmed roadwheels, and torsion suspension arms
 * - Sloped glacis with Explosive Reactive Armor (ERA) bricks, tow shackles, driver periscope,
 *   caged tactical headlights, rear engine radiator grilles, twin external auxiliary fuel drums,
 *   and dual exhaust stacks
 * - Cast/welded composite turret with angled wedge armor cheeks, 6x smoke grenade launchers,
 *   CITV panoramic thermal sight with glowing optic lens, roof-mounted heavy machine gun (.50 cal),
 *   bustle ammo rack, and dual flexible whip antennas
 * - Stepped thermal-shroud cannon barrel(s) with bore evacuator and slotted muzzle brake
 */
export function createTankRig(
  model: TankModelSpec,
  facing: 1 | -1,
  renderer: THREE.WebGLRenderer
): TankRig {
  const root = new THREE.Group();
  const s = model.scale;
  root.scale.set(s, s, s);

  const armorMaps = createPbrTextureSet(renderer, model.hullColor, model.turretColor, 'armor');
  const trackMaps = createPbrTextureSet(renderer, '#1f242d', '#333b48', 'tracks');

  const hullMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(model.hullColor),
    map: armorMaps.map,
    normalMap: armorMaps.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: armorMaps.roughnessMap,
    roughness: 0.48,
    metalness: 0.55,
    clearcoat: 0.18,
    clearcoatRoughness: 0.45,
  });

  const turretMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(model.turretColor),
    map: armorMaps.map,
    normalMap: armorMaps.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: armorMaps.roughnessMap,
    roughness: 0.44,
    metalness: 0.6,
    clearcoat: 0.22,
    clearcoatRoughness: 0.4,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.accentColor),
    normalMap: armorMaps.normalMap,
    roughness: 0.34,
    metalness: 0.72,
  });

  const gunmetalMat = new THREE.MeshStandardMaterial({
    color: 0x262c36,
    normalMap: armorMaps.normalMap,
    roughness: 0.35,
    metalness: 0.85,
  });

  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    roughness: 0.88,
    metalness: 0.12,
  });

  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a,
    map: trackMaps.map,
    normalMap: trackMaps.normalMap,
    roughness: 0.65,
    metalness: 0.62,
  });

  const hullGroup = new THREE.Group();
  root.add(hullGroup);

  // ============================================================================
  // 1. REALISTIC CONTINUOUS TRACK SYSTEM, SUSPENSION ARMS & 12 DUAL ROADWHEELS
  // ============================================================================
  const wheels: THREE.Mesh[] = [];
  const tireGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.32, 24);
  tireGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.34, 18);
  rimGeo.rotateX(Math.PI / 2);
  const hubCapGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.37, 12);
  hubCapGeo.rotateX(Math.PI / 2);

  const sprocketGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.3, 12);
  sprocketGeo.rotateX(Math.PI / 2);

  const cleatGeo = new THREE.BoxGeometry(0.14, 0.045, 0.46);

  for (const sideZ of [-1.12, 1.12]) {
    const trackSideGroup = new THREE.Group();
    trackSideGroup.position.z = sideZ;
    hullGroup.add(trackSideGroup);

    // Lower & Upper Track Run Plates
    const lowerTrackRun = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 0.44), trackMat);
    lowerTrackRun.position.set(0, 0.04, 0);
    lowerTrackRun.castShadow = true;
    lowerTrackRun.receiveShadow = true;
    trackSideGroup.add(lowerTrackRun);

    const upperTrackRun = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.05, 0.44), trackMat);
    upperTrackRun.position.set(0, 0.64, 0);
    trackSideGroup.add(upperTrackRun);

    // Angled Front & Rear Track Ramps connecting roadwheels to drive sprocket / idler
    const frontRamp = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.44), trackMat);
    frontRamp.position.set(facing * 1.88, 0.22, 0);
    frontRamp.rotation.z = facing * 0.56;
    trackSideGroup.add(frontRamp);

    const rearRamp = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.44), trackMat);
    rearRamp.position.set(-facing * 1.86, 0.22, 0);
    rearRamp.rotation.z = -facing * 0.56;
    trackSideGroup.add(rearRamp);

    // 14 Individual 3D Steel Track Grouser Cleats along bottom & top
    for (let c = -6; c <= 6; c++) {
      const cleatBot = new THREE.Mesh(cleatGeo, gunmetalMat);
      cleatBot.position.set(c * 0.26, 0.025, 0);
      trackSideGroup.add(cleatBot);
    }

    // Front Toothed Drive Sprocket & Rear Idler Wheel
    for (const endX of [-1.85, 1.85]) {
      const sprocket = new THREE.Mesh(sprocketGeo, gunmetalMat);
      sprocket.position.set(endX, 0.42, 0);
      const sHub = new THREE.Mesh(hubCapGeo, accentMat);
      sprocket.add(sHub);
      trackSideGroup.add(sprocket);
      wheels.push(sprocket);
    }

    // 6 Dual Rubber-Tired Roadwheels with Torsion Suspension Arms
    for (let w = 0; w < 6; w++) {
      const wx = -1.42 + w * 0.57;

      // Torsion swing arm
      const swingArm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.14), gunmetalMat);
      swingArm.position.set(wx - facing * 0.08, 0.36, sideZ > 0 ? -0.14 : 0.14);
      swingArm.rotation.z = facing * 0.35;
      trackSideGroup.add(swingArm);

      const roadWheel = new THREE.Mesh(tireGeo, rubberMat);
      roadWheel.position.set(wx, 0.31, 0);
      roadWheel.castShadow = true;

      const wheelRim = new THREE.Mesh(rimGeo, hullMat);
      const wheelHub = new THREE.Mesh(hubCapGeo, accentMat);
      roadWheel.add(wheelRim, wheelHub);

      trackSideGroup.add(roadWheel);
      wheels.push(roadWheel);
    }

    // Segmented Heavy Armored Side Ballistic Skirts (5 bolted armor plates per side)
    for (let p = 0; p < 5; p++) {
      const px = -1.6 + p * 0.8;
      const skirtPlate = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.34, 0.08), hullMat);
      skirtPlate.position.set(px, 0.62, sideZ > 0 ? 0.24 : -0.24);
      skirtPlate.castShadow = true;
      trackSideGroup.add(skirtPlate);
    }

    // Full-length Fenders / Mudguards with Accent Trim
    const fender = new THREE.Mesh(new THREE.BoxGeometry(4.15, 0.08, 0.54), hullMat);
    fender.position.set(0, 0.8, 0);
    fender.castShadow = true;
    trackSideGroup.add(fender);

    const trimStrip = new THREE.Mesh(new THREE.BoxGeometry(4.16, 0.04, 0.56), accentMat);
    trimStrip.position.set(0, 0.78, 0);
    trackSideGroup.add(trimStrip);
  }

  // ============================================================================
  // 2. MULTI-SLOPED ARMORED HULL, ERA BRICKS, ENGINE DECK & EXTERNAL FUEL DRUMS
  // ============================================================================
  const hullCore = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.58, 1.84), hullMat);
  hullCore.position.set(0, 0.72, 0);
  hullCore.castShadow = true;
  hullCore.receiveShadow = true;
  hullGroup.add(hullCore);

  // Sloped Upper Glacis Armor Plate
  const upperGlacis = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.36, 1.8), hullMat);
  upperGlacis.position.set(facing * 1.48, 0.88, 0);
  upperGlacis.rotation.z = -facing * 0.34;
  upperGlacis.castShadow = true;
  hullGroup.add(upperGlacis);

  // Sloped Lower Glacis Plate
  const lowerGlacis = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.38, 1.78), gunmetalMat);
  lowerGlacis.position.set(facing * 1.88, 0.52, 0);
  lowerGlacis.rotation.z = facing * 0.45;
  hullGroup.add(lowerGlacis);

  // Array of 8 Explosive Reactive Armor (ERA) Bricks on the Upper Glacis
  const eraGeo = new THREE.BoxGeometry(0.32, 0.1, 0.38);
  for (let row = 0; row < 2; row++) {
    for (let col = -1.5; col <= 1.5; col += 1) {
      const eraBrick = new THREE.Mesh(eraGeo, row === 0 ? accentMat : turretMat);
      eraBrick.position.set(
        facing * (1.35 + row * 0.34),
        1.02 - row * 0.11,
        col * 0.42
      );
      eraBrick.rotation.z = -facing * 0.34;
      eraBrick.castShadow = true;
      hullGroup.add(eraBrick);
    }
  }

  // Driver's Armored Periscope Vision Block
  const periscope = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.42), gunmetalMat);
  periscope.position.set(facing * 1.05, 1.06, 0);
  const glassLens = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.06, 0.34),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  );
  glassLens.position.y = 0.02;
  periscope.add(glassLens);
  hullGroup.add(periscope);

  // Dual Caged Tactical LED Headlights & Tow Shackles
  const headlampMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
  for (const lz of [-0.74, 0.74]) {
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.16, 12).rotateZ(Math.PI / 2),
      gunmetalMat
    );
    housing.position.set(facing * 1.98, 0.86, lz);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.17, 12).rotateZ(Math.PI / 2),
      headlampMat
    );
    housing.add(lens);
    hullGroup.add(housing);

    // Front Tow Hook Shackle
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.028, 8, 14), gunmetalMat);
    shackle.position.set(facing * 2.08, 0.56, lz * 0.85);
    hullGroup.add(shackle);
  }

  // Rear Engine Deck with Louvered Radiator Grilles & Twin External Fuel Drums
  const engineDeck = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 1.62), gunmetalMat);
  engineDeck.position.set(-facing * 1.22, 1.02, 0);
  hullGroup.add(engineDeck);

  const drumGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.76, 18);
  drumGeo.rotateX(Math.PI / 2);
  for (const dz of [-0.52, 0.52]) {
    const fuelDrum = new THREE.Mesh(drumGeo, turretMat);
    fuelDrum.position.set(-facing * 2.08, 0.88, dz);
    fuelDrum.castShadow = true;
    const strap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.12, 18).rotateX(Math.PI / 2),
      gunmetalMat
    );
    fuelDrum.add(strap);
    hullGroup.add(fuelDrum);
  }

  // ============================================================================
  // 3. COMPOSITE TURRET, WEDGE ARMOR, SMOKE LAUNCHERS, CITV OPTICS & ROOF MG
  // ============================================================================
  const turretYawGroup = new THREE.Group();
  turretYawGroup.position.set(facing * 0.08, 1.04, 0);
  hullGroup.add(turretYawGroup);

  const turretMeshGroup = new THREE.Group();
  turretYawGroup.add(turretMeshGroup);

  // Armored Turret Ring Collar
  const turretRing = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.96, 0.16, 24), gunmetalMat);
  turretRing.position.y = 0.06;
  turretMeshGroup.add(turretRing);

  // Octagonal / Rounded Cast Composite Turret Core
  const turretCore = new THREE.Mesh(new THREE.CylinderGeometry(0.94, 1.08, 0.62, 10), turretMat);
  turretCore.scale.set(1.18, 1.0, 0.92);
  turretCore.position.set(0, 0.38, 0);
  turretCore.castShadow = true;
  turretCore.receiveShadow = true;
  turretMeshGroup.add(turretCore);

  // Rear Turret Bustle Ammunition Rack & Stowage Basket
  const bustleRack = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.52, 1.46), turretMat);
  bustleRack.position.set(-facing * 0.95, 0.4, 0);
  bustleRack.castShadow = true;
  turretMeshGroup.add(bustleRack);

  const bustleRail = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.12, 1.54), gunmetalMat);
  bustleRail.position.set(-facing * 0.98, 0.64, 0);
  turretMeshGroup.add(bustleRail);

  // Angled Chobham / Composite Wedge Armor Cheeks on Turret Front
  for (const cz of [-0.52, 0.52]) {
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.54, 0.58), hullMat);
    wedge.position.set(facing * 0.86, 0.38, cz);
    wedge.rotation.y = facing * (cz > 0 ? -0.32 : 0.32);
    wedge.rotation.z = -facing * 0.15;
    wedge.castShadow = true;
    turretMeshGroup.add(wedge);

    // ERA Panel on Turret Cheek
    const cheekEra = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 0.08), accentMat);
    cheekEra.position.set(0, 0.02, cz > 0 ? 0.28 : -0.28);
    wedge.add(cheekEra);

    // 3x Smoke Grenade Discharger Tubes per side
    const smokeTubeGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.28, 10);
    smokeTubeGeo.rotateZ(Math.PI / 2);
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const tube = new THREE.Mesh(smokeTubeGeo, gunmetalMat);
      tube.position.set(
        facing * (0.28 - sIdx * 0.12),
        0.38 + sIdx * 0.08,
        cz > 0 ? 0.98 : -0.98
      );
      tube.rotation.z = facing * (0.35 + sIdx * 0.08);
      tube.rotation.y = facing * (cz > 0 ? -0.25 : 0.25);
      turretMeshGroup.add(tube);
    }
  }

  // Commander's Cupola Hatch & CITV Panoramic Thermal Sight
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.2, 18), gunmetalMat);
  cupola.position.set(-facing * 0.24, 0.74, -0.34);
  turretMeshGroup.add(cupola);

  const citvHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.28, 16), hullMat);
  citvHousing.position.set(facing * 0.22, 0.82, 0.36);
  const opticWindow = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.14, 0.22),
    new THREE.MeshBasicMaterial({ color: 0x10b981 })
  );
  opticWindow.position.set(facing * 0.08, 0.02, 0);
  citvHousing.add(opticWindow);
  turretMeshGroup.add(citvHousing);

  // Roof-Mounted Heavy Machine Gun (.50 Cal / DShK on Pintle Mount)
  const mgGroup = new THREE.Group();
  mgGroup.position.set(-facing * 0.22, 0.88, -0.34);
  turretMeshGroup.add(mgGroup);

  const mgPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.26, 8), gunmetalMat);
  mgGroup.add(mgPost);

  const mgReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.12), gunmetalMat);
  mgReceiver.position.set(facing * 0.1, 0.14, 0);
  mgGroup.add(mgReceiver);

  const mgBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.03, 0.68, 10).rotateZ(Math.PI / 2),
    gunmetalMat
  );
  mgBarrel.position.set(facing * 0.56, 0.15, 0);
  mgGroup.add(mgBarrel);

  const mgAmmoBox = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.16), accentMat);
  mgAmmoBox.position.set(facing * 0.08, 0.1, -0.14);
  mgGroup.add(mgAmmoBox);

  // Dual Flexible Whip Antennas on Rear Turret Bustle
  for (const az of [-0.62, 0.62]) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.028, 1.55, 8), gunmetalMat);
    antenna.position.set(-facing * 1.38, 1.32, az);
    antenna.rotation.z = -facing * 0.08;
    turretMeshGroup.add(antenna);
  }

  // ============================================================================
  // 4. STEPPED SMOOTHBORE CANNON BARREL(S), BORE EVACUATOR & MUZZLE BRAKE
  // ============================================================================
  const barrelElevationGroup = new THREE.Group();
  barrelElevationGroup.position.set(facing * 0.95, 0.4, 0);
  turretMeshGroup.add(barrelElevationGroup);

  const barrelRecoilGroup = new THREE.Group();
  barrelElevationGroup.add(barrelRecoilGroup);

  // Heavy Armored Gun Mantlet
  const mantlet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.86, 18).rotateX(Math.PI / 2),
    gunmetalMat
  );
  mantlet.castShadow = true;
  barrelRecoilGroup.add(mantlet);

  const barrelOffsets = model.barrelCount === 2 ? [-0.24, 0.24] : [0];
  for (const bz of barrelOffsets) {
    // Thermal Shroud Base Sleeve
    const sleeveGeo = new THREE.CylinderGeometry(0.13, 0.145, 0.95, 20);
    sleeveGeo.rotateZ(Math.PI / 2);
    const sleeve = new THREE.Mesh(sleeveGeo, hullMat);
    sleeve.position.set(facing * 0.55, 0, bz);
    sleeve.castShadow = true;
    barrelRecoilGroup.add(sleeve);

    // Main Smoothbore Barrel Tube
    const tubeLen = 2.65;
    const tubeGeo = new THREE.CylinderGeometry(0.095, 0.115, tubeLen, 20);
    tubeGeo.rotateZ(Math.PI / 2);
    const tube = new THREE.Mesh(tubeGeo, gunmetalMat);
    tube.position.set(facing * (tubeLen * 0.5 + 0.2), 0, bz);
    tube.castShadow = true;
    barrelRecoilGroup.add(tube);

    // Central Fume Extractor (Bore Evacuator) with Clamping Rings
    const evacGeo = new THREE.CylinderGeometry(0.155, 0.155, 0.54, 20);
    evacGeo.rotateZ(Math.PI / 2);
    const evac = new THREE.Mesh(evacGeo, turretMat);
    evac.position.set(facing * 1.45, 0, bz);
    evac.castShadow = true;
    barrelRecoilGroup.add(evac);

    for (const rx of [-0.25, 0.25]) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.165, 0.165, 0.05, 20).rotateZ(Math.PI / 2),
        accentMat
      );
      ring.position.set(facing * (1.45 + rx), 0, bz);
      barrelRecoilGroup.add(ring);
    }

    // Slotted Multi-Baffle Muzzle Brake
    const brakeGeo = new THREE.CylinderGeometry(0.16, 0.135, 0.38, 18);
    brakeGeo.rotateZ(Math.PI / 2);
    const brake = new THREE.Mesh(brakeGeo, gunmetalMat);
    brake.position.set(facing * (tubeLen + 0.28), 0, bz);
    const brakeCollar = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.28, 0.34),
      accentMat
    );
    brake.add(brakeCollar);
    barrelRecoilGroup.add(brake);
  }

  // Muzzle Blast Fireball Sphere
  const muzzleFlashGeo = new THREE.IcosahedronGeometry(0.62, 2);
  const muzzleFlashMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.0,
  });
  const muzzleFlashMesh = new THREE.Mesh(muzzleFlashGeo, muzzleFlashMat);
  muzzleFlashMesh.position.set(facing * 3.15, 0, 0);
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

export function updateTankPose(
  rig: TankRig,
  facing: 1 | -1,
  barrelAngleDeg: number,
  turretYawRad: number,
  slopeAngleRad: number,
  dt: number
): void {
  if (rig.destroyed) return;

  rig.hullGroup.rotation.z = THREE.MathUtils.lerp(
    rig.hullGroup.rotation.z,
    slopeAngleRad,
    1 - Math.exp(-10 * dt)
  );

  rig.turretYawGroup.rotation.y = THREE.MathUtils.lerp(
    rig.turretYawGroup.rotation.y,
    facing === 1 ? -turretYawRad : turretYawRad,
    1 - Math.exp(-12 * dt)
  );

  const elevRad = (Math.max(4, Math.min(75, barrelAngleDeg)) * Math.PI) / 180;
  rig.barrelElevationGroup.rotation.z = facing === 1 ? elevRad : -elevRad;

  if (rig.recoilOffset > 0.001) {
    rig.recoilOffset = Math.max(0, rig.recoilOffset - dt * 2.6);
    rig.barrelRecoilGroup.position.x = -facing * rig.recoilOffset;
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
      child.material.color.setHex(0x18181b);
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
    vy: 12.0 + Math.random() * 3.5,
    vz: (Math.random() - 0.5) * 4.5,
    rx: (Math.random() - 0.5) * 7.0,
    ry: (Math.random() - 0.5) * 6.0,
    rz: (Math.random() - 0.5) * 8.0,
  };
}

export function stepFlyingTurret(
  rig: TankRig,
  dt: number,
  getGroundHeight: (x: number) => number
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

  const groundY = getGroundHeight(ft.mesh.position.x) + 0.35;
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
    color: 0x334155,
    metalness: 0.88,
    roughness: 0.22,
  });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  const noseGeo = new THREE.ConeGeometry(0.11, 0.42, 16);
  noseGeo.rotateZ(-Math.PI / 2);
  const noseMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.45,
    metalness: 0.7,
    roughness: 0.2,
  });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0.55, 0, 0);
  group.add(nose);

  const glowGeo = new THREE.SphereGeometry(0.24, 12, 12);
  const glowMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.65,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(-0.32, 0, 0);
  group.add(glow);

  return group;
}

/**
 * Creates a realistic Military Supply Crate with steel corner brackets.
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
      color: 0xf1f5f9,
      roughness: 0.35,
      metalness: 0.25,
    });
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

    const box = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.95, 1.12), boxMat);
    box.castShadow = true;
    group.add(box);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.14, 1.18), bracketMat);
    frame.position.y = 0.42;
    group.add(frame);

    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.2, 1.16), crossMat);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 1.16), crossMat);
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
      emissiveIntensity: 0.35,
      roughness: 0.22,
      metalness: 0.9,
    });

    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.92, 1.08), boxMat);
    chest.castShadow = true;
    group.add(chest);

    const band = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.22, 1.14), goldMat);
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
 * Creates realistic multi-part 3D Military Obstacles (Reinforced Pillbox Bunker with Sandbags,
 * Pressurized Industrial Fuel Silo, Concrete Anti-Tank Barrier, and Stratified Boulder).
 */
export function createObstacleRig(
  obs: DestructibleObstacle,
  concreteMaps: PbrTextureSet
): ObstacleRig {
  const group = new THREE.Group();
  group.position.set(obs.x, obs.y, obs.z);

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    map: concreteMaps.map,
    normalMap: concreteMaps.normalMap,
    roughnessMap: concreteMaps.roughnessMap,
    roughness: 0.82,
    metalness: 0.18,
  });

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x27272a,
    roughness: 0.42,
    metalness: 0.82,
  });

  if (obs.kind === 'fuel_tank') {
    const tankMat = new THREE.MeshPhysicalMaterial({
      color: 0xb91c1c,
      normalMap: concreteMaps.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.36,
      metalness: 0.65,
      clearcoat: 0.2,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.35,
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

    // Domed Top Cap & Pressure Valve
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

    // Structural Support Ring
    const baseRing = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.08, radius * 1.12, 0.24, 20),
      steelMat
    );
    baseRing.position.y = 0.12;
    group.add(baseRing);
  } else if (obs.kind === 'bunker') {
    // Octagonal Reinforced Concrete Pillbox Bunker
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

    // Armored Firing Slit Embrasure
    const slitFrame = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width * 0.65, 0.38, obs.depth * 0.92),
      steelMat
    );
    slitFrame.position.y = obs.height * 0.56;
    group.add(slitFrame);

    // Sandbag Parapet on Bunker Roof
    const sandbagMat = new THREE.MeshStandardMaterial({
      color: 0xa18868,
      normalMap: concreteMaps.normalMap,
      roughness: 0.9,
      metalness: 0.05,
    });
    for (let s = -2; s <= 2; s++) {
      const bag = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 12, 8),
        sandbagMat
      );
      bag.scale.set(1.4, 0.65, 0.9);
      bag.position.set(s * 0.42, obs.height * 0.98, 0.45);
      group.add(bag);
    }
  } else if (obs.kind === 'wall') {
    // Sloped Jersey-style Reinforced Anti-Tank Concrete Wall with Rebar
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

    // Protruding Steel Rebar Rods
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
    // Sculpted Natural Rock Outcrop Formation (non-spherical organic cliff boulders)
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x8c7862,
      map: concreteMaps.map,
      normalMap: concreteMaps.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 0.9,
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
    flashTimer: 0,
  };
}

/**
 * Builds a 3D Scorched Crater Rim & Scattered Rock Debris Mesh placed at shell impact coordinates.
 */
export function createCraterDecalMesh(
  x: number,
  y: number,
  z: number,
  radius: number,
  depth: number,
  slopeRad: number
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.z = slopeRad * 0.5;

  // Scorched inner crater bowl ring
  const scorchGeo = new THREE.RingGeometry(0.1, radius * 0.95, 24);
  scorchGeo.rotateX(-Math.PI / 2);
  const scorchMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    roughness: 0.96,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const scorchDisc = new THREE.Mesh(scorchGeo, scorchMat);
  scorchDisc.position.y = -depth * 0.45 + 0.05;
  group.add(scorchDisc);

  // Raised 3D Ejecta Soil Rim Torus
  const rimGeo = new THREE.TorusGeometry(radius * 0.86, Math.min(0.28, depth * 0.25), 10, 24);
  rimGeo.rotateX(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x27272a,
    roughness: 0.94,
    metalness: 0.08,
  });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.scale.set(1, 1, 0.55);
  rimMesh.position.y = 0.04;
  group.add(rimMesh);

  // 6 Chunks of Blasted Rock Debris around the crater rim
  const rockGeo = new THREE.IcosahedronGeometry(0.18, 1);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + (x % 1);
    const r = radius * (0.78 + (i % 2) * 0.2);
    const chunk = new THREE.Mesh(rockGeo, rimMat);
    chunk.position.set(Math.cos(ang) * r, 0.08, Math.sin(ang) * r);
    chunk.scale.set(1.2, 0.65, 1.0);
    group.add(chunk);
  }

  return group;
}

/**
 * Creates a GLSL Atmospheric Sky Dome with Volumetric Horizon Haze & Sun Disc.
 */
export function createBiomeSkyDome(): {
  domeGroup: THREE.Group;
  updateBiomeSky: (biome: BiomeType) => void;
} {
  const domeGroup = new THREE.Group();

  const skyGeo = new THREE.SphereGeometry(260, 32, 24);
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x0f172a) },
    midColor: { value: new THREE.Color(0x475569) },
    bottomColor: { value: new THREE.Color(0xd97706) },
    sunDir: { value: new THREE.Vector3(0.28, 0.24, -0.92).normalize() },
    sunColor: { value: new THREE.Color(0xfef08a) },
  };

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.26, h));
        col = mix(col, topColor, smoothstep(0.26, 0.85, h));
        float sunAmt = max(dot(dir, sunDir), 0.0);
        col += sunColor * pow(sunAmt, 16.0) * 0.45;
        col += sunColor * smoothstep(0.996, 0.9995, sunAmt) * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  domeGroup.add(new THREE.Mesh(skyGeo, skyMat));

  const updateBiomeSky = (biome: BiomeType) => {
    if (biome === 'desert') {
      skyUniforms.topColor.value.setHex(0x172554);
      skyUniforms.midColor.value.setHex(0x9a3412);
      skyUniforms.bottomColor.value.setHex(0xf59e0b);
      skyUniforms.sunColor.value.setHex(0xfef08a);
    } else if (biome === 'snow') {
      skyUniforms.topColor.value.setHex(0x0f172a);
      skyUniforms.midColor.value.setHex(0x0284c7);
      skyUniforms.bottomColor.value.setHex(0xe0f2fe);
      skyUniforms.sunColor.value.setHex(0xffffff);
    } else if (biome === 'industrial') {
      skyUniforms.topColor.value.setHex(0x090d16);
      skyUniforms.midColor.value.setHex(0x334155);
      skyUniforms.bottomColor.value.setHex(0x64748b);
      skyUniforms.sunColor.value.setHex(0x94a3b8);
    } else if (biome === 'volcanic') {
      skyUniforms.topColor.value.setHex(0x180909);
      skyUniforms.midColor.value.setHex(0x7f1d1d);
      skyUniforms.bottomColor.value.setHex(0xea580c);
      skyUniforms.sunColor.value.setHex(0xf97316);
    } else {
      skyUniforms.topColor.value.setHex(0x020617);
      skyUniforms.midColor.value.setHex(0x0f172a);
      skyUniforms.bottomColor.value.setHex(0x1e293b);
      skyUniforms.sunColor.value.setHex(0x38bdf8);
    }
  };

  return { domeGroup, updateBiomeSky };
}
