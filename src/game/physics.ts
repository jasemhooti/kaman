export type BiomeType = 'desert' | 'snow' | 'industrial' | 'volcanic' | 'night';
export type HitZone = 'turret' | 'hull' | 'tracks';
export type CameraPreset = 'tactical' | 'turret' | 'side' | 'drone' | 'cinematic';

export interface TankModelSpec {
  id: string;
  index: number;
  name: string;
  codeName: string;
  price: number; // 0 for the first 3 unlocked tanks
  armorMultiplier: number;
  damageMultiplier: number;
  moveFuelMax: number; // speed / mobility rating
  barrelCount: 1 | 2;
  hullColor: string;
  turretColor: string;
  accentColor: string;
  scale: number;
  description: string;
}

export interface ShellSpec {
  id: string;
  name: string;
  price: number; // 0 for default shell; unlimited ammo once unlocked
  minTankIndex: number;
  damageMultiplier: number;
  muzzleVelocityMultiplier: number;
  blastRadius: number;
  craterDepth: number;
  colorHex: number;
  badgeColor: string;
  description: string;
}

export interface TankCombatState {
  id: 1 | 2;
  name: string;
  model: TankModelSpec;
  shell: ShellSpec;
  x: number;
  y: number;
  z: number;
  slopeAngle: number;
  rollAngle?: number;
  hullYaw?: number; // 360-degree open-world hull heading in radians (0 = +X, PI = -X)
  facing: 1 | -1; // 1 = facing +X, -1 = facing -X (legacy/fallback direction)
  turretYawRad: number; // horizontal turret aim offset relative to hull/facing
  barrelAngleDeg: number; // elevation angle (5 to 75 deg)
  powerPct: number; // 20 to 100%
  hp: number;
  maxHp: number;
  moveFuel: number;
  maxMoveFuel: number;
  tracksDamaged: boolean;
  shotsFired: number;
  hitsLanded: number;
  critHits: number;
  lastLandingX: number | null;
}

export type ObstacleKind =
  | 'bunker'
  | 'fuel_tank'
  | 'rock'
  | 'wall'
  | 'watchtower'
  | 'radar_dome'
  | 'warehouse';

export interface DestructibleObstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotationY?: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface SupplyCrate {
  id: string;
  kind: 'heal' | 'coins';
  x: number;
  y: number;
  z: number;
  collected: boolean;
  value: number; // +25% HP or +55 coins
}

export interface TerrainCrater {
  id: string;
  x: number;
  z: number;
  radius: number;
  depth: number;
}

export interface BattlefieldConfig {
  seed: number;
  stageNumber: number;
  biome: BiomeType;
  biomeTitle: string;
  worldSize: number; // 260m x 260m Open World
  distance: number; // initial spawn separation between tanks
  leftHillHeight: number;
  rightHillHeight: number;
  centerRidgeHeight: number;
  centerRidgeX: number;
  roughnessFreq: number;
  roughnessAmp: number;
  obstacles: DestructibleObstacle[];
  crates: SupplyCrate[];
  craters: TerrainCrater[];
}

export interface TrajectoryPoint {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
}

export interface HitDetectionResult {
  hitType: 'none' | 'tank' | 'obstacle' | 'crate' | 'ground';
  targetTankId?: 1 | 2;
  hitZone?: HitZone;
  obstacleId?: string;
  crateId?: string;
  damage?: number;
  craterRadius?: number;
  craterDepth?: number;
  impactPoint: { x: number; y: number; z: number };
}

export const GRAVITY = 9.81;
export const MIN_MUZZLE_SPEED = 16;
export const MAX_MUZZLE_SPEED = 48;
export const OPEN_WORLD_RADIUS = 108; // Navigable radius inside 260m x 260m world
// Short trajectory guide line right next to the tank barrel (4.6 meters)
export const TRAJECTORY_PREVIEW_MAX_METERS = 4.6;

/**
 * 10 Realistic Tank Models:
 * First 3 are unlocked for free (price: 0).
 * Next 7 are purchasable with coins from cheap to expensive.
 */
export const TANK_CATALOG: TankModelSpec[] = [
  {
    id: 'zulfiqar_1',
    index: 0,
    name: 'ذوالفقار سبک',
    codeName: 'ZULFIQAR MK-I',
    price: 0,
    armorMultiplier: 1.0,
    damageMultiplier: 1.0,
    moveFuelMax: 8.5,
    barrelCount: 1,
    hullColor: '#5c6b4d',
    turretColor: '#4a573d',
    accentColor: '#d97706',
    scale: 1.0,
    description: 'تانک چابک جهان‌آزاد با زره واکنشی و چرخش سریع برجک',
  },
  {
    id: 'saeqeh_2',
    index: 1,
    name: 'صاعقه صحرا',
    codeName: 'SAEQEH DESERT',
    price: 0,
    armorMultiplier: 1.05,
    damageMultiplier: 1.05,
    moveFuelMax: 8.8,
    barrelCount: 1,
    hullColor: '#b89762',
    turretColor: '#9c7e4e',
    accentColor: '#ea580c',
    scale: 1.03,
    description: 'تانک استتار صحرایی با پایداری عالی در تپه‌های شنی جهان‌آزاد',
  },
  {
    id: 'aghrab_3',
    index: 2,
    name: 'عقرب زرهی',
    codeName: 'SCORPION AFV',
    price: 0,
    armorMultiplier: 1.09,
    damageMultiplier: 1.08,
    moveFuelMax: 9.0,
    barrelCount: 1,
    hullColor: '#56677d',
    turretColor: '#435266',
    accentColor: '#0284c7',
    scale: 1.05,
    description: 'شاسی پهن زرهی با سیستم تعلیق مستقل برای نبردهای جهان‌آزاد',
  },
  {
    id: 'babr_4',
    index: 3,
    name: 'ببر فولادی',
    codeName: 'STEEL TIGER',
    price: 150,
    armorMultiplier: 1.16,
    damageMultiplier: 1.16,
    moveFuelMax: 9.2,
    barrelCount: 1,
    hullColor: '#4d6f28',
    turretColor: '#3f5c20',
    accentColor: '#65a30d',
    scale: 1.08,
    description: 'زره کامپوزیت چندلایه و توپ ۱۲۰ میلی‌متری دوربرد',
  },
  {
    id: 'tondar_5',
    index: 4,
    name: 'تندر واکنش‌گر',
    codeName: 'THUNDER ERA',
    price: 320,
    armorMultiplier: 1.25,
    damageMultiplier: 1.25,
    moveFuelMax: 9.5,
    barrelCount: 1,
    hullColor: '#63666a',
    turretColor: '#4f5256',
    accentColor: '#ea580c',
    scale: 1.1,
    description: 'مجهز به بلوک‌های زره واکنشی انفجاری و موتور توربودیزل ۱۲۰۰ اسب‌بخار',
  },
  {
    id: 'shahab_6',
    index: 5,
    name: 'شهاب سنگین',
    codeName: 'SHAHAB HEAVY',
    price: 550,
    armorMultiplier: 1.36,
    damageMultiplier: 1.36,
    moveFuelMax: 9.8,
    barrelCount: 1,
    hullColor: '#2d4a7c',
    turretColor: '#223860',
    accentColor: '#3b82f6',
    scale: 1.13,
    description: 'تانک سنگین کالیبر ۱۲۵ میلی‌متری با قدرت تخریب سنگر بالا',
  },
  {
    id: 'azhdaha_7',
    index: 6,
    name: 'اژدهای سرخ',
    codeName: 'CRIMSON DRAGON',
    price: 850,
    armorMultiplier: 1.48,
    damageMultiplier: 1.48,
    moveFuelMax: 10.2,
    barrelCount: 2,
    hullColor: '#8c2d2d',
    turretColor: '#6e2222',
    accentColor: '#ef4444',
    scale: 1.16,
    description: 'برجک دو لول هم‌زمان با شاسی فوق‌سنگین و زره مقاوم',
  },
  {
    id: 'titan_8',
    index: 7,
    name: 'غول تیتانیوم',
    codeName: 'TITAN MAMMOTH',
    price: 1250,
    armorMultiplier: 1.62,
    damageMultiplier: 1.62,
    moveFuelMax: 10.6,
    barrelCount: 2,
    hullColor: '#4b5b6e',
    turretColor: '#384657',
    accentColor: '#06b6d4',
    scale: 1.2,
    description: 'بدنه تیتانیومی ضدنفوذ با دو توپ موازی کالیبر سنگین',
  },
  {
    id: 'shabgard_9',
    index: 8,
    name: 'شکارچی شب',
    codeName: 'NIGHT STALKER',
    price: 1800,
    armorMultiplier: 1.78,
    damageMultiplier: 1.78,
    moveFuelMax: 11.2,
    barrelCount: 2,
    hullColor: '#3f4248',
    turretColor: '#2d3036',
    accentColor: '#9333ea',
    scale: 1.22,
    description: 'تانک نسل پنجم رادارگریز با سامانه نشانه‌گیری حرارتی',
  },
  {
    id: 'emperor_10',
    index: 9,
    name: 'امپراتور میدان',
    codeName: 'IMPERIAL OVERLORD',
    price: 2500,
    armorMultiplier: 1.98,
    damageMultiplier: 1.95,
    moveFuelMax: 12.0,
    barrelCount: 2,
    hullColor: '#8c6229',
    turretColor: '#6e4b1c',
    accentColor: '#eab308',
    scale: 1.26,
    description: 'قوی‌ترین ابرتانک دو لول بازی با زره طلایی-تیتانیوم و قدرت ویرانگر',
  },
];

/**
 * 4 Tank Shell Types (Unlimited Ammo once unlocked in the Shell Shop)
 */
export const SHELL_CATALOG: ShellSpec[] = [
  {
    id: 'shell_standard',
    name: 'گلوله استاندارد جنگی (APHE)',
    price: 0,
    minTankIndex: 0,
    damageMultiplier: 1.0,
    muzzleVelocityMultiplier: 1.0,
    blastRadius: 2.8,
    craterDepth: 0.78,
    colorHex: 0xf59e0b,
    badgeColor: '#f59e0b',
    description: 'مهمات نامحدود پایه با تعادل عالی بین سرعت و قدرت انفجار',
  },
  {
    id: 'shell_ap_sabot',
    name: 'گلوله ضدزره نفوذی (Sabot AP)',
    price: 200,
    minTankIndex: 0,
    damageMultiplier: 1.22,
    muzzleVelocityMultiplier: 1.1,
    blastRadius: 3.0,
    craterDepth: 0.9,
    colorHex: 0x38bdf8,
    badgeColor: '#38bdf8',
    description: 'سرعت دهانه بالاتر و +۲۲٪ تخریب بیشتر روی زره و برجک تانک (مهمات نامحدود)',
  },
  {
    id: 'shell_he_heavy',
    name: 'گلوله انفجار شدید (Heavy HE)',
    price: 450,
    minTankIndex: 2,
    damageMultiplier: 1.38,
    muzzleVelocityMultiplier: 0.96,
    blastRadius: 4.0,
    craterDepth: 1.22,
    colorHex: 0xf97316,
    badgeColor: '#f97316',
    description: 'موج انفجار وسیع، گودال عمیق و +۳۸٪ قدرت تخریب روی تانک و سنگرها (مهمات نامحدود)',
  },
  {
    id: 'shell_plasma',
    name: 'گلوله حرارتی پلاسما (Plasma)',
    price: 900,
    minTankIndex: 4,
    damageMultiplier: 1.6,
    muzzleVelocityMultiplier: 1.06,
    blastRadius: 4.8,
    craterDepth: 1.48,
    colorHex: 0xa855f7,
    badgeColor: '#a855f7',
    description: 'قوی‌ترین گلوله حرارتی با +۶۰٪ تخریب مرگبار و حفر گودال عمیق (مهمات نامحدود)',
  },
];

export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const BIOME_LIST: Array<{ biome: BiomeType; title: string }> = [
  { biome: 'desert', title: 'صحرای طلایی سینا · جهان‌آزاد' },
  { biome: 'snow', title: 'ارتفاعات برفی قفقاز · جهان‌آزاد' },
  { biome: 'industrial', title: 'پالایشگاه صنعتی · جهان‌آزاد' },
  { biome: 'volcanic', title: 'دره آتشفشانی بازالت · جهان‌آزاد' },
  { biome: 'night', title: 'پایگاه راداری شبانه · جهان‌آزاد' },
];

/**
 * Generates an expansive 260m x 260m 3D Open-World battlefield map for each stage
 * with 2D hills, valleys, military bases, watchtowers, radar domes, bunkers, fuel depots, and supply crates.
 */
export function generateBattlefieldConfig(seed: number = Date.now(), stageNumber: number = 1): BattlefieldConfig {
  const rng = seededRandom(seed + stageNumber * 7919);
  const biomeEntry = BIOME_LIST[(stageNumber - 1) % BIOME_LIST.length];

  const distance = Math.round(56 + rng() * 18 + Math.min(12, stageNumber * 1.2));
  const leftHillHeight = Number(((rng() - 0.35) * 4.4).toFixed(2));
  const rightHillHeight = Number(((rng() - 0.35) * 4.4).toFixed(2));
  const centerRidgeHeight = Number((0.9 + rng() * 2.8).toFixed(2));
  const centerRidgeX = Number(((rng() - 0.5) * 16).toFixed(2));
  const roughnessFreq = Number((0.065 + rng() * 0.045).toFixed(3));
  const roughnessAmp = Number((0.45 + rng() * 0.45).toFixed(2));

  const tempArena: BattlefieldConfig = {
    seed,
    stageNumber,
    biome: biomeEntry.biome,
    biomeTitle: biomeEntry.title,
    worldSize: 260,
    distance,
    leftHillHeight,
    rightHillHeight,
    centerRidgeHeight,
    centerRidgeX,
    roughnessFreq,
    roughnessAmp,
    obstacles: [],
    crates: [],
    craters: [],
  };

  const obstacles: DestructibleObstacle[] = [];
  const halfDist = distance * 0.5;

  // 1. Central Valley Tactical Cover (3-4 obstacles between initial tank spawns)
  const centerKinds: ObstacleKind[] = ['bunker', 'fuel_tank', 'rock', 'wall'];
  const centerCount = 3 + (rng() > 0.45 ? 1 : 0);
  const span = distance * 0.48;
  for (let i = 0; i < centerCount; i++) {
    const t = centerCount === 1 ? 0 : i / (centerCount - 1) - 0.5;
    const ox = Number((t * span + (rng() - 0.5) * 4.5).toFixed(2));
    const oz = Number(((rng() - 0.5) * 14.0).toFixed(2));
    const kind = centerKinds[Math.floor(rng() * centerKinds.length)];
    obstacles.push(createObstacleData(`obs-c-${i}`, kind, ox, oz, rng() * Math.PI * 2, tempArena));
  }

  // 2. Open-World Military Outposts, Watchtowers, Radar Stations & Rock Outcrops across 200m x 200m
  const openWorldPlacements: Array<{ kind: ObstacleKind; x: number; z: number }> = [
    { kind: 'watchtower', x: -34, z: -28 },
    { kind: 'radar_dome', x: 18, z: -36 },
    { kind: 'warehouse', x: -12, z: 34 },
    { kind: 'bunker', x: 32, z: 26 },
    { kind: 'fuel_tank', x: -8, z: 30 },
    { kind: 'watchtower', x: 48, z: -24 },
    { kind: 'rock', x: -52, z: 24 },
    { kind: 'rock', x: 54, z: 32 },
    { kind: 'wall', x: -22, z: -18 },
    { kind: 'bunker', x: 24, z: -16 },
    { kind: 'warehouse', x: -46, z: -42 },
    { kind: 'fuel_tank', x: 42, z: 40 },
  ];

  openWorldPlacements.forEach((p, idx) => {
    const jitterX = Number((p.x + (rng() - 0.5) * 8).toFixed(2));
    const jitterZ = Number((p.z + (rng() - 0.5) * 8).toFixed(2));
    // Keep initial spawn zones clear
    if (Math.hypot(jitterX + halfDist, jitterZ) < 10 || Math.hypot(jitterX - halfDist, jitterZ) < 10) {
      return;
    }
    obstacles.push(
      createObstacleData(`obs-ow-${idx}`, p.kind, jitterX, jitterZ, rng() * Math.PI * 2, tempArena)
    );
  });

  // 3. Supply Crates scattered across the Open World (first 2 near central corridor, 4 more in open world)
  const healCrateX = Number((-halfDist + 5.5 + rng() * 3.0).toFixed(2));
  const coinCrateX = Number(((rng() - 0.5) * (distance * 0.35)).toFixed(2));
  const healZ = Number(((rng() - 0.5) * 4.0).toFixed(2));
  const coinZ = Number(((rng() - 0.5) * 4.0).toFixed(2));

  const crates: SupplyCrate[] = [
    {
      id: `crate-heal-${stageNumber}-1`,
      kind: 'heal',
      x: healCrateX,
      y: terrainHeightAt(healCrateX, tempArena, healZ),
      z: healZ,
      collected: false,
      value: 25,
    },
    {
      id: `crate-coin-${stageNumber}-1`,
      kind: 'coins',
      x: coinCrateX,
      y: terrainHeightAt(coinCrateX, tempArena, coinZ),
      z: coinZ,
      collected: false,
      value: 55 + stageNumber * 10,
    },
    {
      id: `crate-heal-${stageNumber}-2`,
      kind: 'heal',
      x: 16,
      y: terrainHeightAt(16, tempArena, 24),
      z: 24,
      collected: false,
      value: 25,
    },
    {
      id: `crate-coin-${stageNumber}-2`,
      kind: 'coins',
      x: -24,
      y: terrainHeightAt(-24, tempArena, -22),
      z: -22,
      collected: false,
      value: 65 + stageNumber * 12,
    },
  ];

  tempArena.obstacles = obstacles;
  tempArena.crates = crates;
  return tempArena;
}

function createObstacleData(
  id: string,
  kind: ObstacleKind,
  x: number,
  z: number,
  rotationY: number,
  arena: BattlefieldConfig
): DestructibleObstacle {
  const y = terrainHeightAt(x, arena, z);
  let width = 3.2;
  let height = 2.8;
  let depth = 3.2;
  let maxHp = 95;

  if (kind === 'fuel_tank') {
    width = 2.4;
    height = 3.0;
    depth = 2.4;
    maxHp = 50;
  } else if (kind === 'bunker') {
    width = 4.2;
    height = 2.9;
    depth = 3.8;
    maxHp = 120;
  } else if (kind === 'wall') {
    width = 2.6;
    height = 3.2;
    depth = 4.4;
    maxHp = 135;
  } else if (kind === 'watchtower') {
    width = 3.8;
    height = 7.8;
    depth = 3.8;
    maxHp = 90;
  } else if (kind === 'radar_dome') {
    width = 4.6;
    height = 5.6;
    depth = 4.6;
    maxHp = 110;
  } else if (kind === 'warehouse') {
    width = 6.4;
    height = 4.2;
    depth = 4.8;
    maxHp = 150;
  } else {
    width = 3.6;
    height = 2.8;
    depth = 3.4;
    maxHp = 100;
  }

  return {
    id,
    kind,
    x,
    y,
    z,
    width,
    height,
    depth,
    rotationY,
    hp: maxHp,
    maxHp,
    destroyed: false,
  };
}

/**
 * Evaluates smooth natural 2D Open-World terrain height y at (x, z),
 * including 2D hills, valley roads, perimeter mountain ridges, and dynamic shell impact craters!
 */
export function terrainHeightAt(x: number, arena: BattlefieldConfig, z: number = 0): number {
  const halfDist = arena.distance * 0.5;

  const leftDistSq = (x - -halfDist) * (x - -halfDist) + z * z * 0.35;
  const leftHill = arena.leftHillHeight * Math.exp(-leftDistSq / 140);

  const rightDistSq = (x - halfDist) * (x - halfDist) + z * z * 0.35;
  const rightHill = arena.rightHillHeight * Math.exp(-rightDistSq / 140);

  const centerDistSq = (x - arena.centerRidgeX) * (x - arena.centerRidgeX) + (z - 4) * (z - 4) * 0.25;
  const centerRidge = arena.centerRidgeHeight * Math.exp(-centerDistSq / 180);

  // 2D Open-World Rolling Hills & Dunes across X and Z
  const platformMask =
    1 -
    0.72 * Math.exp(-leftDistSq / 32) -
    0.72 * Math.exp(-rightDistSq / 32);

  const openWorldUndulation =
    (Math.sin(x * arena.roughnessFreq + z * 0.045) *
      Math.cos(x * arena.roughnessFreq * 0.58 - z * 0.052) +
      0.48 * Math.sin(x * 0.032 - z * 0.041) +
      0.28 * Math.cos(x * 0.14 + z * 0.13)) *
    arena.roughnessAmp *
    Math.max(0.15, platformMask);

  // Flatten slightly along the winding military road (z ≈ 14 * sin(x * 0.03))
  const roadCenterZ = 14 * Math.sin(x * 0.03);
  const distFromRoad = Math.abs(z - roadCenterZ);
  const roadFlatten = distFromRoad < 5.5 ? 1 - 0.55 * Math.cos((distFromRoad / 5.5) * Math.PI * 0.5) : 1.0;

  // Natural Outer Mountain Range Rim beyond radius 92m so the Open World is bounded by realistic peaks
  const radialDist = Math.hypot(x, z);
  let mountainRim = 0;
  if (radialDist > 88) {
    const rimT = (radialDist - 88) / 42;
    const ridgeWave =
      0.65 +
      0.35 * Math.sin(Math.atan2(z, x) * 7 + arena.seed * 0.01) +
      0.2 * Math.cos(x * 0.08 + z * 0.08);
    mountainRim = Math.min(24, rimT * rimT * 14.5 * ridgeWave);
  }

  // Subtract dynamic impact craters (bowl depression + subtle raised rim)
  let craterDelta = 0;
  if (arena.craters && arena.craters.length > 0) {
    for (const c of arena.craters) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.radius * 1.35) {
        const u = d / c.radius;
        if (u <= 1.0) {
          craterDelta -= c.depth * Math.cos(u * Math.PI * 0.5) * (1 - u * u * 0.35);
        } else {
          const rimT = (u - 1.0) / 0.35;
          craterDelta += c.depth * 0.18 * Math.sin(rimT * Math.PI);
        }
      }
    }
  }

  return (leftHill + rightHill + centerRidge + openWorldUndulation) * roadFlatten + mountainRim + craterDelta;
}

/**
 * Computes terrain slope angle (in radians) at (x, z) along X or along a custom heading angle.
 */
export function terrainSlopeAt(
  x: number,
  arena: BattlefieldConfig,
  z: number = 0,
  headingRad: number = 0
): number {
  const delta = 0.7;
  const dx = Math.cos(headingRad) * delta;
  const dz = Math.sin(headingRad) * delta;
  const y1 = terrainHeightAt(x - dx, arena, z - dz);
  const y2 = terrainHeightAt(x + dx, arena, z + dz);
  return Math.atan2(y2 - y1, delta * 2);
}

/**
 * Computes lateral terrain roll angle perpendicular to the tank's heading.
 */
export function terrainRollAt(
  x: number,
  arena: BattlefieldConfig,
  z: number = 0,
  headingRad: number = 0
): number {
  const delta = 0.7;
  const rx = -Math.sin(headingRad) * delta;
  const rz = Math.cos(headingRad) * delta;
  const yLeft = terrainHeightAt(x - rx, arena, z - rz);
  const yRight = terrainHeightAt(x + rx, arena, z + rz);
  return Math.atan2(yRight - yLeft, delta * 2);
}

/**
 * Returns the tank's world aim yaw in the XZ plane (0 = +X, PI/2 = +Z, PI = -X).
 * Combines 360-degree hullYaw (if present) or facing (+1/-1) with turretYawRad.
 */
export function getTankWorldAimYaw(tank: TankCombatState): number {
  if (typeof tank.hullYaw === 'number') {
    return tank.hullYaw + tank.turretYawRad;
  }
  return tank.facing === 1 ? tank.turretYawRad : Math.PI - tank.turretYawRad;
}

/**
 * Generates dynamic wind speed in [-10, +10] m/s.
 */
export function generateTurnWind(biome: BiomeType, seed: number = Date.now()): number {
  const rng = seededRandom(seed);
  const maxWind = biome === 'snow' || biome === 'desert' ? 9.5 : biome === 'industrial' ? 8.0 : 6.5;
  const raw = (rng() * 2 - 1) * maxWind;
  return Number(raw.toFixed(1));
}

export function powerToMuzzleVelocity(powerPct: number, shellMultiplier = 1.0): number {
  const clamped = Math.max(15, Math.min(100, powerPct));
  const normalized = (clamped - 15) / 85;
  return (MIN_MUZZLE_SPEED + normalized * (MAX_MUZZLE_SPEED - MIN_MUZZLE_SPEED)) * shellMultiplier;
}

/**
 * Returns the world 3D coordinates of the tank's cannon muzzle tip in 360-degree open-world space.
 */
export function getTankMuzzleOrigin(tank: TankCombatState): { x: number; y: number; z: number } {
  const angleRad = (tank.barrelAngleDeg * Math.PI) / 180;
  const scale = tank.model.scale;
  const turretPivotY = tank.y + 1.52 * scale;
  const barrelLen = 3.45 * scale;
  const worldYaw = getTankWorldAimYaw(tank);

  const horizReach = Math.cos(angleRad) * barrelLen;
  const mx = tank.x + horizReach * Math.cos(worldYaw);
  const my = turretPivotY + Math.sin(angleRad) * barrelLen;
  const mz = tank.z + horizReach * Math.sin(worldYaw);
  return { x: mx, y: my, z: mz };
}

/**
 * Steps projectile physics under gravity (g) and dynamic horizontal wind.
 */
export function stepProjectile(
  state: TrajectoryPoint,
  dt: number,
  windSpeed: number
): TrajectoryPoint {
  const windAccel = windSpeed * 0.52;
  const nextVx = state.vx + windAccel * dt;
  const nextVy = state.vy - GRAVITY * dt;
  const nextVz = state.vz * (1 - 0.04 * dt);

  return {
    x: state.x + state.vx * dt + 0.5 * windAccel * dt * dt,
    y: state.y + state.vy * dt - 0.5 * GRAVITY * dt * dt,
    z: state.z + state.vz * dt,
    vx: nextVx,
    vy: nextVy,
    vz: nextVz,
    t: state.t + dt,
  };
}

/**
 * Computes the short dashed trajectory preview right next to the tank barrel (strictly capped at 3-5m).
 */
export function computeShortTrajectoryPreview(
  tank: TankCombatState,
  windSpeed: number,
  maxLengthMeters: number = TRAJECTORY_PREVIEW_MAX_METERS
): Array<{ x: number; y: number; z: number }> {
  const cappedMax = Math.max(3.0, Math.min(5.0, maxLengthMeters));
  const origin = getTankMuzzleOrigin(tank);
  const speed = powerToMuzzleVelocity(tank.powerPct, tank.shell.muzzleVelocityMultiplier);
  const angleRad = (tank.barrelAngleDeg * Math.PI) / 180;
  const worldYaw = getTankWorldAimYaw(tank);

  let current: TrajectoryPoint = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    vx: speed * Math.cos(angleRad) * Math.cos(worldYaw),
    vy: speed * Math.sin(angleRad),
    vz: speed * Math.cos(angleRad) * Math.sin(worldYaw),
    t: 0,
  };

  const points: Array<{ x: number; y: number; z: number }> = [{ x: current.x, y: current.y, z: current.z }];
  let accumulatedLength = 0;
  const dt = 0.02;

  for (let i = 0; i < 65; i++) {
    const next = stepProjectile(current, dt, windSpeed);
    const segLen = Math.hypot(next.x - current.x, next.y - current.y, next.z - current.z);

    if (accumulatedLength + segLen >= cappedMax) {
      const remain = cappedMax - accumulatedLength;
      const ratio = segLen > 0 ? remain / segLen : 0;
      points.push({
        x: current.x + (next.x - current.x) * ratio,
        y: current.y + (next.y - current.y) * ratio,
        z: current.z + (next.z - current.z) * ratio,
      });
      break;
    }

    points.push({ x: next.x, y: next.y, z: next.z });
    accumulatedLength += segLen;
    current = next;
  }

  return points;
}

/**
 * Checks 3D localized tank hitboxes in 360-degree space:
 * - Turret / Weakspot ('turret'): Critical Damage (38% to 52% base HP, scaled by shell & tank power)
 * - Main Hull ('hull'): Medium Damage (24% to 34% base HP)
 * - Tracks / Wheels ('tracks'): Lower Damage (14% to 20% base HP + slows movement)
 */
export function checkTankHitbox(
  px: number,
  py: number,
  pz: number,
  tank: TankCombatState,
  attacker: TankCombatState
): { hitZone: HitZone; damage: number } | null {
  if (py < tank.y - 0.35 || py > tank.y + 3.25 * tank.model.scale) return null;

  const s = tank.model.scale;
  const radialDist = Math.hypot(px - tank.x, pz - tank.z);
  const dx = Math.abs(px - tank.x);
  const dz = Math.abs(pz - tank.z);

  const zLimit = 2.05 * s + Math.max(0, (attacker.shell.blastRadius - 2.2) * 0.35);
  if (dz > zLimit && radialDist > 2.65 * s) return null;

  const relY = (py - tank.y) / s;
  const combatRatio =
    (attacker.model.damageMultiplier * attacker.shell.damageMultiplier) /
    Math.max(0.8, tank.model.armorMultiplier);

  if (relY >= 1.28 && relY <= 2.38 && dx <= 1.55 * s) {
    const centerFactor = 1 - Math.min(1, dx / (1.55 * s));
    const rawDamage = (38 + centerFactor * 14) * combatRatio;
    return { hitZone: 'turret', damage: Math.round(Math.max(25, Math.min(95, rawDamage))) };
  }

  if (relY >= 0.62 && relY < 1.28 && dx <= 2.45 * s) {
    const centerFactor = 1 - Math.min(1, dx / (2.45 * s));
    const rawDamage = (24 + centerFactor * 10) * combatRatio;
    return { hitZone: 'hull', damage: Math.round(Math.max(16, Math.min(65, rawDamage))) };
  }

  if (relY >= 0.0 && relY < 0.62 && dx <= 2.65 * s) {
    const centerFactor = 1 - Math.min(1, dx / (2.65 * s));
    const rawDamage = (14 + centerFactor * 6) * combatRatio;
    return { hitZone: 'tracks', damage: Math.round(Math.max(10, Math.min(40, rawDamage))) };
  }

  return null;
}

/**
 * Checks whether a point (px, py, pz) hits any supply crate, destructible obstacle, tank, or ground.
 */
export function evaluatePointCollision(
  px: number,
  py: number,
  pz: number,
  shooterId: 1 | 2,
  tanks: [TankCombatState, TankCombatState],
  arena: BattlefieldConfig,
  elapsedTime: number
): HitDetectionResult {
  const shooter = tanks[shooterId - 1];

  // 1. Check Supply Crates
  for (const crate of arena.crates) {
    if (crate.collected) continue;
    if (
      Math.abs(px - crate.x) <= 1.5 &&
      py >= crate.y - 0.25 &&
      py <= crate.y + 1.9 &&
      Math.abs(pz - crate.z) <= 1.65
    ) {
      return {
        hitType: 'crate',
        crateId: crate.id,
        impactPoint: { x: px, y: py, z: pz },
      };
    }
  }

  // 2. Check Tanks (skip shooter during initial 0.16s muzzle clearance)
  for (const tank of tanks) {
    if (tank.hp <= 0) continue;
    if (tank.id === shooterId && elapsedTime < 0.16) continue;
    const hit = checkTankHitbox(px, py, pz, tank, shooter);
    if (hit) {
      return {
        hitType: 'tank',
        targetTankId: tank.id,
        hitZone: hit.hitZone,
        damage: hit.damage,
        craterRadius: shooter.shell.blastRadius * 0.85,
        craterDepth: shooter.shell.craterDepth * 0.5,
        impactPoint: { x: px, y: py, z: pz },
      };
    }
  }

  // 3. Check Destructible Battlefield Obstacles
  for (const obs of arena.obstacles) {
    if (obs.destroyed) continue;
    const halfW = obs.width * 0.5;
    const halfD = obs.depth * 0.5;
    if (
      px >= obs.x - halfW &&
      px <= obs.x + halfW &&
      py >= obs.y &&
      py <= obs.y + obs.height &&
      Math.abs(pz - obs.z) <= halfD + 0.6
    ) {
      return {
        hitType: 'obstacle',
        obstacleId: obs.id,
        damage: Math.round(48 * shooter.shell.damageMultiplier * shooter.model.damageMultiplier),
        craterRadius: shooter.shell.blastRadius * 0.9,
        craterDepth: shooter.shell.craterDepth * 0.6,
        impactPoint: { x: px, y: py, z: pz },
      };
    }
  }

  // 4. Check Ground Terrain + Splash Damage near Opponent Tank + Crater Carving
  const groundY = terrainHeightAt(px, arena, pz);
  if (py <= groundY) {
    for (const tank of tanks) {
      if (tank.hp <= 0) continue;
      if (tank.id === shooterId && elapsedTime < 0.25) continue;
      const distToTank = Math.hypot(px - tank.x, pz - tank.z);
      if (distToTank <= shooter.shell.blastRadius + 1.25) {
        const splashFactor = Math.max(0.35, 1 - distToTank / (shooter.shell.blastRadius + 1.55));
        const splashDmg = Math.round(18 * splashFactor * shooter.shell.damageMultiplier);
        return {
          hitType: 'tank',
          targetTankId: tank.id,
          hitZone: 'tracks',
          damage: Math.max(8, splashDmg),
          craterRadius: shooter.shell.blastRadius,
          craterDepth: shooter.shell.craterDepth,
          impactPoint: { x: px, y: groundY, z: pz },
        };
      }
    }

    return {
      hitType: 'ground',
      craterRadius: shooter.shell.blastRadius,
      craterDepth: shooter.shell.craterDepth,
      impactPoint: { x: px, y: groundY, z: pz },
    };
  }

  return {
    hitType: 'none',
    impactPoint: { x: px, y: py, z: pz },
  };
}

/**
 * Simulates an entire shell flight for AI trajectory planning in 3D space.
 */
export function simulateFullShot(
  shooter: TankCombatState,
  barrelAngleDeg: number,
  powerPct: number,
  windSpeed: number,
  tanks: [TankCombatState, TankCombatState],
  arena: BattlefieldConfig
): { path: TrajectoryPoint[]; result: HitDetectionResult } {
  const testShooter: TankCombatState = { ...shooter, barrelAngleDeg, powerPct };
  const origin = getTankMuzzleOrigin(testShooter);
  const speed = powerToMuzzleVelocity(powerPct, testShooter.shell.muzzleVelocityMultiplier);
  const angleRad = (barrelAngleDeg * Math.PI) / 180;
  const worldYaw = getTankWorldAimYaw(testShooter);

  let current: TrajectoryPoint = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    vx: speed * Math.cos(angleRad) * Math.cos(worldYaw),
    vy: speed * Math.sin(angleRad),
    vz: speed * Math.cos(angleRad) * Math.sin(worldYaw),
    t: 0,
  };

  const path: TrajectoryPoint[] = [current];
  const dt = 0.02;
  const subSteps = 3;
  const maxSteps = 550;

  for (let step = 0; step < maxSteps; step++) {
    const next = stepProjectile(current, dt, windSpeed);

    for (let s = 1; s <= subSteps; s++) {
      const alpha = s / subSteps;
      const ix = current.x + (next.x - current.x) * alpha;
      const iy = current.y + (next.y - current.y) * alpha;
      const iz = current.z + (next.z - current.z) * alpha;
      const it = current.t + dt * alpha;

      const hit = evaluatePointCollision(ix, iy, iz, shooter.id, tanks, arena, it);
      if (hit.hitType !== 'none') {
        path.push({ ...next, x: hit.impactPoint.x, y: hit.impactPoint.y, z: hit.impactPoint.z, t: it });
        return { path, result: hit };
      }
    }

    path.push(next);
    current = next;

    if (Math.hypot(current.x, current.z) > OPEN_WORLD_RADIUS * 1.45 || current.y < -35) {
      return {
        path,
        result: {
          hitType: 'ground',
          impactPoint: { x: current.x, y: terrainHeightAt(current.x, arena, current.z), z: current.z },
        },
      };
    }
  }

  return {
    path,
    result: {
      hitType: 'ground',
      impactPoint: { x: current.x, y: terrainHeightAt(current.x, arena, current.z), z: current.z },
    },
  };
}

export function selectEnemyTankForStage(playerTankIndex: number, stageNumber: number): TankModelSpec {
  const targetIndex = Math.min(
    TANK_CATALOG.length - 1,
    Math.max(playerTankIndex, Math.floor((stageNumber - 1) * 0.85) + Math.min(2, playerTankIndex))
  );
  return TANK_CATALOG[targetIndex];
}

/**
 * Steps continuous 360-degree Open-World tank driving physics (forward/reverse throttle + hull steering + obstacle avoidance).
 */
export function stepTankOpenWorldDrive(
  tank: TankCombatState,
  otherTank: TankCombatState,
  arena: BattlefieldConfig,
  throttleInput: number, // -1 (reverse) to +1 (forward)
  steerInput: number, // -1 (turn right) to +1 (turn left)
  dt: number
): TankCombatState {
  if (tank.hp <= 0) return tank;

  const baseHullYaw =
    typeof tank.hullYaw === 'number' ? tank.hullYaw : tank.facing === 1 ? 0 : Math.PI;
  const mobilityFactor = tank.tracksDamaged ? 0.55 : 1.0;
  const turnSpeed = 1.45 * mobilityFactor;
  const maxDriveSpeed = (tank.model.moveFuelMax || 9.0) * 1.15 * mobilityFactor;

  let nextHullYaw = baseHullYaw + steerInput * turnSpeed * dt;
  // Normalize angle to [-PI, PI]
  nextHullYaw = Math.atan2(Math.sin(nextHullYaw), Math.cos(nextHullYaw));

  const forwardSpeed = throttleInput * maxDriveSpeed;
  let nextX = tank.x + Math.cos(nextHullYaw) * forwardSpeed * dt;
  let nextZ = tank.z + Math.sin(nextHullYaw) * forwardSpeed * dt;

  // Keep inside navigable Open-World perimeter (radius <= 98m)
  const distFromCenter = Math.hypot(nextX, nextZ);
  if (distFromCenter > 96) {
    const scaleBack = 96 / distFromCenter;
    nextX *= scaleBack;
    nextZ *= scaleBack;
  }

  // Push out of destructible obstacles so tanks drive around buildings/rocks realistically
  for (const obs of arena.obstacles) {
    if (obs.destroyed) continue;
    const minClearance = Math.max(obs.width, obs.depth) * 0.5 + 2.35;
    const dx = nextX - obs.x;
    const dz = nextZ - obs.z;
    const d = Math.hypot(dx, dz);
    if (d < minClearance && d > 0.001) {
      nextX = obs.x + (dx / d) * minClearance;
      nextZ = obs.z + (dz / d) * minClearance;
    }
  }

  // Prevent overlapping the other tank
  const dxTank = nextX - otherTank.x;
  const dzTank = nextZ - otherTank.z;
  const dTank = Math.hypot(dxTank, dzTank);
  if (dTank < 5.2 && dTank > 0.001) {
    nextX = otherTank.x + (dxTank / dTank) * 5.2;
    nextZ = otherTank.z + (dzTank / dTank) * 5.2;
  }

  const nextY = terrainHeightAt(nextX, arena, nextZ);
  const nextSlope = terrainSlopeAt(nextX, arena, nextZ, nextHullYaw);
  const nextRoll = terrainRollAt(nextX, arena, nextZ, nextHullYaw);

  return {
    ...tank,
    x: nextX,
    y: nextY,
    z: nextZ,
    hullYaw: nextHullYaw,
    slopeAngle: nextSlope,
    rollAngle: nextRoll,
    moveFuel: tank.maxMoveFuel, // Open-world unlimited fuel
  };
}

/**
 * Computes AI Tank tactical movement & 3D ballistic solution in the Open World.
 */
export function computeAITankTurn(
  aiTank: TankCombatState,
  playerTank: TankCombatState,
  windSpeed: number,
  arena: BattlefieldConfig,
  stageNumber: number,
  seed: number = Date.now()
): {
  moveDeltaX: number;
  moveDeltaZ: number;
  barrelAngleDeg: number;
  powerPct: number;
  turretYawRad: number;
} {
  const rng = seededRandom(seed);

  const maxStep = Math.min(aiTank.moveFuel, 4.5);
  const moveDeltaX = Number(((rng() - 0.5) * 2 * maxStep * 0.85).toFixed(2));
  const moveDeltaZ = Number(((rng() - 0.5) * 2 * maxStep * 0.85).toFixed(2));

  const movedAi: TankCombatState = {
    ...aiTank,
    x: aiTank.x + moveDeltaX,
    z: Math.max(-75, Math.min(75, aiTank.z + moveDeltaZ)),
  };
  movedAi.y = terrainHeightAt(movedAi.x, arena, movedAi.z);

  const desiredWorldYaw = Math.atan2(playerTank.z - movedAi.z, playerTank.x - movedAi.x);
  const turretYawRad =
    typeof movedAi.hullYaw === 'number'
      ? Math.atan2(
          Math.sin(desiredWorldYaw - movedAi.hullYaw),
          Math.cos(desiredWorldYaw - movedAi.hullYaw)
        )
      : Math.atan2(playerTank.z - movedAi.z, Math.abs(playerTank.x - movedAi.x));

  movedAi.turretYawRad = turretYawRad;

  const targetX = playerTank.x;
  const targetY = playerTank.y + 1.25 * playerTank.model.scale;
  const targetZ = playerTank.z;

  let bestAngle = 34;
  let bestPower = 72;
  let bestScore = Infinity;

  const candidateAngles = [18, 22, 26, 30, 34, 38, 42, 48, 54, 60];
  for (const ang of candidateAngles) {
    for (let pwr = 30; pwr <= 98; pwr += 4) {
      const sim = simulateFullShot(movedAi, ang, pwr, windSpeed, [playerTank, movedAi], arena);
      if (sim.result.hitType === 'tank' && sim.result.targetTankId === playerTank.id) {
        const zoneBonus =
          sim.result.hitZone === 'turret' ? -25 : sim.result.hitZone === 'hull' ? -12 : -5;
        if (zoneBonus < bestScore) {
          bestScore = zoneBonus;
          bestAngle = ang;
          bestPower = pwr;
        }
      } else {
        const distErr = Math.hypot(
          sim.result.impactPoint.x - targetX,
          sim.result.impactPoint.y - targetY,
          sim.result.impactPoint.z - targetZ
        );
        const obsPenalty = sim.result.hitType === 'obstacle' ? 18 : 0;
        const totalErr = distErr + obsPenalty;
        if (totalErr < bestScore) {
          bestScore = totalErr;
          bestAngle = ang;
          bestPower = pwr;
        }
      }
    }
  }

  const accuracyFactor = Math.max(0.16, 1 - (stageNumber - 1) * 0.12);
  const angleJitter = (rng() * 2 - 1) * 5.0 * accuracyFactor;
  const powerJitter = (rng() * 2 - 1) * 7.0 * accuracyFactor;

  return {
    moveDeltaX,
    moveDeltaZ,
    barrelAngleDeg: Math.round(Math.max(8, Math.min(75, bestAngle + angleJitter))),
    powerPct: Math.round(Math.max(22, Math.min(100, bestPower + powerJitter))),
    turretYawRad,
  };
}
