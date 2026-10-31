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
  // Turret blow-off physics state when HP reaches 0
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

/**
 * Generates high-detail procedural textures for tank armor, steel tracks, bunkers, and terrain biomes.
 */
export function createProceduralTexture(
  renderer: THREE.WebGLRenderer,
  baseHex: string,
  accentHex: string,
  style: 'armor' | 'terrain' | 'concrete' | 'tracks' = 'armor'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  if (style === 'armor') {
    // Brushed rolled homogeneous steel armor with subtle camo patches & rivets
    ctx.fillStyle = accentHex;
    for (let i = 0; i < 18; i++) {
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      ctx.ellipse(
        (i * 67) % 256,
        (i * 109) % 256,
        28 + (i % 3) * 14,
        16 + (i % 4) * 10,
        (i * 0.6) % Math.PI,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    // Armor panel seams and rivets
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 240, 240);
    ctx.beginPath();
    ctx.moveTo(0, 128);
    ctx.lineTo(256, 128);
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    for (let x = 20; x < 240; x += 36) {
      ctx.fillRect(x, 14, 3, 3);
      ctx.fillRect(x, 238, 3, 3);
    }
  } else if (style === 'tracks') {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#475569';
    for (let y = 0; y < 256; y += 16) {
      ctx.fillRect(4, y + 2, 248, 9);
    }
  } else if (style === 'concrete') {
    ctx.fillStyle = accentHex;
    for (let y = 0; y < 256; y += 32) {
      ctx.globalAlpha = 0.22;
      ctx.fillRect(0, y, 256, 2);
    }
    for (let i = 0; i < 400; i++) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = i % 2 === 0 ? '#0f172a' : '#e2e8f0';
      ctx.fillRect((i * 53) % 256, (i * 89) % 256, 4, 4);
    }
  } else {
    // Terrain grain
    for (let i = 0; i < 650; i++) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = i % 2 === 0 ? accentHex : '#ffffff';
      ctx.fillRect((i * 73) % 256, (i * 41) % 256, 6, 3);
    }
  }

  ctx.globalAlpha = 1.0;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

/**
 * Builds a realistic multi-part 3D Tank Rig (Chassis, Sloped Glacis, ERA Blocks, Roadwheels, Tracks,
 * Rotating Turret, Cupola, Antenna, Single/Dual Recoil Barrels, and Muzzle Flash).
 */
export function createTankRig(
  model: TankModelSpec,
  facing: 1 | -1,
  renderer: THREE.WebGLRenderer
): TankRig {
  const root = new THREE.Group();
  const s = model.scale;
  root.scale.set(s, s, s);

  const armorTex = createProceduralTexture(renderer, model.hullColor, model.turretColor, 'armor');
  const trackTex = createProceduralTexture(renderer, '#1e293b', '#334155', 'tracks');

  const hullMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.hullColor),
    map: armorTex,
    roughness: 0.46,
    metalness: 0.42,
  });

  const turretMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.turretColor),
    map: armorTex,
    roughness: 0.42,
    metalness: 0.48,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(model.accentColor),
    roughness: 0.32,
    metalness: 0.65,
  });

  const darkSteelMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.45,
    metalness: 0.72,
  });

  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x27272a,
    map: trackTex,
    roughness: 0.78,
    metalness: 0.35,
  });

  const hullGroup = new THREE.Group();
  root.add(hullGroup);

  // 1. Left & Right Track Assemblies + 12 Roadwheels
  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 14);
  wheelGeo.rotateX(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.28, 10);
  hubGeo.rotateX(Math.PI / 2);

  for (const sideZ of [-1.05, 1.05]) {
    // Track Belt Box + Rounded Ends
    const trackBelt = new THREE.Mesh(new THREE.BoxGeometry(3.75, 0.56, 0.46), trackMat);
    trackBelt.position.set(0, 0.32, sideZ);
    trackBelt.castShadow = true;
    trackBelt.receiveShadow = true;
    hullGroup.add(trackBelt);

    // Armored Side Skirts over upper tracks
    const sideSkirt = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.28, 0.52), hullMat);
    sideSkirt.position.set(0, 0.66, sideZ);
    sideSkirt.castShadow = true;
    hullGroup.add(sideSkirt);

    // Accent stripe on side skirt
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.07, 0.54), accentMat);
    stripe.position.set(0, 0.68, sideZ);
    hullGroup.add(stripe);

    // 6 Roadwheels per side
    for (let w = 0; w < 6; w++) {
      const wx = -1.45 + w * 0.58;
      const wheel = new THREE.Mesh(wheelGeo, darkSteelMat);
      wheel.position.set(wx, 0.32, sideZ + (sideZ > 0 ? 0.12 : -0.12));
      const hub = new THREE.Mesh(hubGeo, accentMat);
      wheel.add(hub);
      hullGroup.add(wheel);
      wheels.push(wheel);
    }
  }

  // 2. Main Armored Hull Core
  const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.58, 1.78), hullMat);
  lowerHull.position.set(0, 0.68, 0);
  lowerHull.castShadow = true;
  lowerHull.receiveShadow = true;
  hullGroup.add(lowerHull);

  // Sloped Front Glacis Plate
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.42, 1.72), hullMat);
  glacis.position.set(facing * 1.42, 0.84, 0);
  glacis.rotation.z = -facing * 0.28;
  glacis.castShadow = true;
  hullGroup.add(glacis);

  // Rear Engine Deck & Exhaust Louvers
  const engineDeck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 1.5), darkSteelMat);
  engineDeck.position.set(-facing * 1.15, 0.99, 0);
  hullGroup.add(engineDeck);

  // Headlight glow pods on front hull
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  for (const lz of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.18), lightMat);
    lamp.position.set(facing * 1.82, 0.88, lz);
    hullGroup.add(lamp);
  }

  // 3. Rotating Turret Group
  const turretYawGroup = new THREE.Group();
  turretYawGroup.position.set(-facing * 0.12, 1.02, 0);
  hullGroup.add(turretYawGroup);

  const turretMeshGroup = new THREE.Group();
  turretYawGroup.add(turretMeshGroup);

  // Main Turret Body
  const turretCore = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.64, 1.48), turretMat);
  turretCore.position.set(0, 0.34, 0);
  turretCore.castShadow = true;
  turretCore.receiveShadow = true;
  turretMeshGroup.add(turretCore);

  // Sloped Turret Front Cheeks (Composite Armor Wedge)
  for (const cz of [-0.44, 0.44]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.56, 0.56), accentMat);
    cheek.position.set(facing * 0.88, 0.34, cz);
    cheek.rotation.y = facing * (cz > 0 ? -0.22 : 0.22);
    cheek.castShadow = true;
    turretMeshGroup.add(cheek);
  }

  // Commander Cupola Hatch & Radio Whip Antenna
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.24, 12), darkSteelMat);
  cupola.position.set(-facing * 0.35, 0.74, -0.32);
  turretMeshGroup.add(cupola);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.35, 6), darkSteelMat);
  antenna.position.set(-facing * 0.78, 1.25, 0.48);
  turretMeshGroup.add(antenna);

  // 4. Cannon Barrel Elevation & Recoil Group (Supports Single or Dual Barrels!)
  const barrelElevationGroup = new THREE.Group();
  barrelElevationGroup.position.set(facing * 0.85, 0.38, 0);
  turretMeshGroup.add(barrelElevationGroup);

  const barrelRecoilGroup = new THREE.Group();
  barrelElevationGroup.add(barrelRecoilGroup);

  // Gun Mantlet
  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.38, 0.76), darkSteelMat);
  barrelRecoilGroup.add(mantlet);

  const barrelOffsets = model.barrelCount === 2 ? [-0.22, 0.22] : [0];
  for (const bz of barrelOffsets) {
    // Main Barrel Tube
    const tubeLen = 2.45;
    const tubeGeo = new THREE.CylinderGeometry(0.095, 0.115, tubeLen, 14);
    tubeGeo.rotateZ(Math.PI / 2);
    const tube = new THREE.Mesh(tubeGeo, darkSteelMat);
    tube.position.set(facing * (tubeLen * 0.5 + 0.15), 0, bz);
    tube.castShadow = true;
    barrelRecoilGroup.add(tube);

    // Bore Evacuator (Fume Extractor bulge mid-barrel)
    const evacGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.48, 14);
    evacGeo.rotateZ(Math.PI / 2);
    const evac = new THREE.Mesh(evacGeo, hullMat);
    evac.position.set(facing * 1.25, 0, bz);
    barrelRecoilGroup.add(evac);

    // Muzzle Brake
    const brakeGeo = new THREE.CylinderGeometry(0.15, 0.13, 0.32, 12);
    brakeGeo.rotateZ(Math.PI / 2);
    const brake = new THREE.Mesh(brakeGeo, accentMat);
    brake.position.set(facing * (tubeLen + 0.22), 0, bz);
    barrelRecoilGroup.add(brake);
  }

  // Muzzle Blast Fireball Sphere (briefly visible upon firing)
  const muzzleFlashGeo = new THREE.DodecahedronGeometry(0.55, 1);
  const muzzleFlashMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.0,
  });
  const muzzleFlashMesh = new THREE.Mesh(muzzleFlashGeo, muzzleFlashMat);
  muzzleFlashMesh.position.set(facing * 2.85, 0, 0);
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
 * Updates the tank's 3D barrel elevation angle, turret yaw, hull slope tilt, and recoil recovery.
 */
export function updateTankPose(
  rig: TankRig,
  facing: 1 | -1,
  barrelAngleDeg: number,
  turretYawRad: number,
  slopeAngleRad: number,
  dt: number
): void {
  if (rig.destroyed) return;

  // Pitch hull to match terrain slope
  rig.hullGroup.rotation.z = THREE.MathUtils.lerp(rig.hullGroup.rotation.z, slopeAngleRad, 1 - Math.exp(-10 * dt));

  // Rotate turret horizontally
  rig.turretYawGroup.rotation.y = THREE.MathUtils.lerp(
    rig.turretYawGroup.rotation.y,
    facing === 1 ? -turretYawRad : turretYawRad,
    1 - Math.exp(-12 * dt)
  );

  // Elevate cannon barrel (clamped visually so barrel always points upward from horizontal)
  const elevRad = (Math.max(4, Math.min(75, barrelAngleDeg)) * Math.PI) / 180;
  rig.barrelElevationGroup.rotation.z = facing === 1 ? elevRad : -elevRad;

  // Recover barrel recoil and fade muzzle flash
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

/**
 * Detaches the 3D tank turret and launches it spinning into the air when HP reaches 0!
 */
export function triggerTankExplosion(
  rig: TankRig,
  scene: THREE.Scene
): void {
  if (rig.turretBlownOff) return;
  rig.destroyed = true;
  rig.turretBlownOff = true;

  // Scorch the tank hull dark charcoal
  rig.hullGroup.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material = child.material.clone();
      child.material.color.setHex(0x18181b);
      child.material.roughness = 0.92;
    }
  });

  // Detach turretMeshGroup into world coordinates and launch upward
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
    vy: 11.5 + Math.random() * 3.5,
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
 * Creates a glowing 3D Artillery Shell Mesh.
 */
export function createShellMesh(colorHex = 0xf59e0b): THREE.Group {
  const group = new THREE.Group();

  const bodyGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.65, 10);
  bodyGeo.rotateZ(-Math.PI / 2);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.85,
    roughness: 0.25,
  });
  group.add(new THREE.Mesh(bodyGeo, bodyMat));

  const noseGeo = new THREE.ConeGeometry(0.11, 0.36, 10);
  noseGeo.rotateZ(-Math.PI / 2);
  const noseMat = new THREE.MeshBasicMaterial({ color: colorHex });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0.48, 0, 0);
  group.add(nose);

  const glowGeo = new THREE.SphereGeometry(0.22, 8, 8);
  const glowMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.55,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(-0.25, 0, 0);
  group.add(glow);

  return group;
}

/**
 * Creates a 3D Supply Crate (First-Aid Heal Crate with Red/Green Cross or Gold Coin Crate).
 */
export function createSupplyCrateMesh(crate: SupplyCrate): CrateRig {
  const group = new THREE.Group();
  group.position.set(crate.x, crate.y + 0.55, crate.z);

  if (crate.kind === 'heal') {
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.4,
      metalness: 0.2,
    });
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });

    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.95, 1.1), boxMat);
    box.castShadow = true;
    group.add(box);

    // Glowing Green Medical Cross on front & top
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.2, 1.14), crossMat);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 1.14), crossMat);
    group.add(hBar, vBar);
  } else {
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xb45309,
      roughness: 0.35,
      metalness: 0.65,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 0.35,
      roughness: 0.25,
      metalness: 0.85,
    });

    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.9, 1.05), boxMat);
    chest.castShadow = true;
    group.add(chest);

    const band = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 1.1), goldMat);
    band.position.y = 0.15;
    group.add(band);
  }

  return {
    id: crate.id,
    kind: crate.kind,
    group,
  };
}

/**
 * Creates a Destructible Battlefield Obstacle (Concrete Bunker, Explosive Fuel Tank, Jagged Rock, or Blast Wall).
 */
export function createObstacleRig(
  obs: DestructibleObstacle,
  concreteTex: THREE.CanvasTexture
): ObstacleRig {
  const group = new THREE.Group();
  group.position.set(obs.x, obs.y, obs.z);

  if (obs.kind === 'fuel_tank') {
    const tankMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.38,
      metalness: 0.55,
    });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });

    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(obs.width * 0.48, obs.width * 0.48, obs.height, 14),
      tankMat
    );
    cyl.position.y = obs.height * 0.5;
    cyl.castShadow = true;
    cyl.receiveShadow = true;
    group.add(cyl);

    const hazardBand = new THREE.Mesh(
      new THREE.CylinderGeometry(obs.width * 0.5, obs.width * 0.5, obs.height * 0.22, 14),
      stripeMat
    );
    hazardBand.position.y = obs.height * 0.55;
    group.add(hazardBand);
  } else if (obs.kind === 'bunker') {
    const bunkerMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      map: concreteTex,
      roughness: 0.82,
      metalness: 0.18,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(obs.width, obs.height * 0.82, obs.depth), bunkerMat);
    body.position.y = obs.height * 0.41;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width * 1.08, obs.height * 0.22, obs.depth * 1.08),
      bunkerMat
    );
    roof.position.y = obs.height * 0.88;
    roof.castShadow = true;
    group.add(roof);

    // Firing slit
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(obs.width * 0.7, 0.28, obs.depth * 1.03),
      new THREE.MeshBasicMaterial({ color: 0x090d16 })
    );
    slit.position.y = obs.height * 0.58;
    group.add(slit);
  } else if (obs.kind === 'wall') {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x78716c,
      map: concreteTex,
      roughness: 0.85,
      metalness: 0.15,
    });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(obs.width, obs.height, obs.depth), wallMat);
    wall.position.y = obs.height * 0.5;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  } else {
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x57534e,
      map: concreteTex,
      roughness: 0.9,
      metalness: 0.08,
      flatShading: true,
    });
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(obs.width * 0.58, 1), rockMat);
    rock.position.y = obs.height * 0.46;
    rock.scale.set(1.0, obs.height / obs.width, 0.95);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  return {
    id: obs.id,
    kind: obs.kind,
    group,
    flashTimer: 0,
  };
}

/**
 * Creates a GLSL Atmospheric Sky Dome that adapts its colors to the current stage biome.
 */
export function createBiomeSkyDome(): {
  domeGroup: THREE.Group;
  updateBiomeSky: (biome: BiomeType) => void;
} {
  const domeGroup = new THREE.Group();

  const skyGeo = new THREE.SphereGeometry(240, 28, 18);
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
        vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.28, h));
        col = mix(col, topColor, smoothstep(0.28, 0.88, h));
        float sunAmt = max(dot(dir, sunDir), 0.0);
        col += sunColor * pow(sunAmt, 14.0) * 0.42;
        col += sunColor * smoothstep(0.996, 0.9995, sunAmt) * 0.85;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  domeGroup.add(new THREE.Mesh(skyGeo, skyMat));

  const updateBiomeSky = (biome: BiomeType) => {
    if (biome === 'desert') {
      skyUniforms.topColor.value.setHex(0x1e3a8a);
      skyUniforms.midColor.value.setHex(0xb45309);
      skyUniforms.bottomColor.value.setHex(0xfbbf24);
      skyUniforms.sunColor.value.setHex(0xfef08a);
    } else if (biome === 'snow') {
      skyUniforms.topColor.value.setHex(0x0f172a);
      skyUniforms.midColor.value.setHex(0x38bdf8);
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
      // night radar outpost
      skyUniforms.topColor.value.setHex(0x020617);
      skyUniforms.midColor.value.setHex(0x0f172a);
      skyUniforms.bottomColor.value.setHex(0x1e293b);
      skyUniforms.sunColor.value.setHex(0x38bdf8);
    }
  };

  return { domeGroup, updateBiomeSky };
}
