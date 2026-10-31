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
  moveFuelMax: number; // meters per turn
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
  facing: 1 | -1; // 1 = facing +X, -1 = facing -X
  turretYawRad: number; // horizontal aim offset
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

export interface DestructibleObstacle {
  id: string;
  kind: 'bunker' | 'fuel_tank' | 'rock' | 'wall';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
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
  value: number; // +25% HP or +50 coins
}

export interface BattlefieldConfig {
  seed: number;
  stageNumber: number;
  biome: BiomeType;
  biomeTitle: string;
  distance: number; // 54m to 78m between tanks
  leftHillHeight: number;
  rightHillHeight: number;
  centerRidgeHeight: number;
  centerRidgeX: number;
  roughnessFreq: number;
  roughnessAmp: number;
  obstacles: DestructibleObstacle[];
  crates: SupplyCrate[];
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
  impactPoint: { x: number; y: number; z: number };
}

export const GRAVITY = 9.81;
export const MIN_MUZZLE_SPEED = 14;
export const MAX_MUZZLE_SPEED = 42;
// Short trajectory guide line right next to the tank barrel (4.5 meters)
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
    moveFuelMax: 5.5,
    barrelCount: 1,
    hullColor: '#4d5d42',
    turretColor: '#3f4d36',
    accentColor: '#eab308',
    scale: 1.0,
    description: 'تانک چابک خط مقدم با مصرف سوخت بهینه و چرخش سریع برجک',
  },
  {
    id: 'saeqeh_2',
    index: 1,
    name: 'صاعقه صحرا',
    codeName: 'SAEQEH DESERT',
    price: 0,
    armorMultiplier: 1.04,
    damageMultiplier: 1.04,
    moveFuelMax: 5.0,
    barrelCount: 1,
    hullColor: '#9a7b4f',
    turretColor: '#7d623c',
    accentColor: '#f59e0b',
    scale: 1.03,
    description: 'تانک استتار صحرایی با پایداری بالا روی تپه‌های شنی',
  },
  {
    id: 'aghrab_3',
    index: 2,
    name: 'عقرب زرهی',
    codeName: 'SCORPION AFV',
    price: 0,
    armorMultiplier: 1.08,
    damageMultiplier: 1.07,
    moveFuelMax: 5.2,
    barrelCount: 1,
    hullColor: '#475569',
    turretColor: '#334155',
    accentColor: '#38bdf8',
    scale: 1.05,
    description: 'شاسی پهن زرهی با سیستم تعلیق مقاوم در برابر موج انفجار',
  },
  {
    id: 'babr_4',
    index: 3,
    name: 'ببر فولادی',
    codeName: 'STEEL TIGER',
    price: 150,
    armorMultiplier: 1.15,
    damageMultiplier: 1.15,
    moveFuelMax: 5.6,
    barrelCount: 1,
    hullColor: '#3f6212',
    turretColor: '#365314',
    accentColor: '#84cc16',
    scale: 1.08,
    description: 'زره کامپوزیت چندلایه و توپ ۱۱۰ میلی‌متری دوربرد',
  },
  {
    id: 'tondar_5',
    index: 4,
    name: 'تندر واکنش‌گر',
    codeName: 'THUNDER ERA',
    price: 320,
    armorMultiplier: 1.24,
    damageMultiplier: 1.25,
    moveFuelMax: 5.8,
    barrelCount: 1,
    hullColor: '#52525b',
    turretColor: '#3f3f46',
    accentColor: '#f97316',
    scale: 1.1,
    description: 'مجهز به بلوک‌های زره واکنشی انفجاری و موتور توربودیزل',
  },
  {
    id: 'shahab_6',
    index: 5,
    name: 'شهاب سنگین',
    codeName: 'SHAHAB HEAVY',
    price: 550,
    armorMultiplier: 1.35,
    damageMultiplier: 1.36,
    moveFuelMax: 6.0,
    barrelCount: 1,
    hullColor: '#1e3a8a',
    turretColor: '#172554',
    accentColor: '#60a5fa',
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
    moveFuelMax: 6.2,
    barrelCount: 2,
    hullColor: '#7f1d1d',
    turretColor: '#5c1414',
    accentColor: '#f87171',
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
    moveFuelMax: 6.5,
    barrelCount: 2,
    hullColor: '#334155',
    turretColor: '#1e293b',
    accentColor: '#22d3ee',
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
    moveFuelMax: 7.0,
    barrelCount: 2,
    hullColor: '#18181b',
    turretColor: '#09090b',
    accentColor: '#a855f7',
    scale: 1.22,
    description: 'تانک نسل پنجم رادارگریز با سامانه نشانه‌گیری لیزری',
  },
  {
    id: 'emperor_10',
    index: 9,
    name: 'امپراتور میدان',
    codeName: 'IMPERIAL OVERLORD',
    price: 2500,
    armorMultiplier: 1.98,
    damageMultiplier: 1.95,
    moveFuelMax: 7.5,
    barrelCount: 2,
    hullColor: '#78350f',
    turretColor: '#451a03',
    accentColor: '#fbbf24',
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
    blastRadius: 2.3,
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
    muzzleVelocityMultiplier: 1.08,
    blastRadius: 2.5,
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
    blastRadius: 3.5,
    colorHex: 0xf97316,
    badgeColor: '#f97316',
    description: 'موج انفجار وسیع و +۳۸٪ قدرت تخریب روی تانک و سنگرها (مهمات نامحدود)',
  },
  {
    id: 'shell_plasma',
    name: 'گلوله حرارتی پلاسما (Plasma)',
    price: 900,
    minTankIndex: 4,
    damageMultiplier: 1.6,
    muzzleVelocityMultiplier: 1.05,
    blastRadius: 4.2,
    colorHex: 0xa855f7,
    badgeColor: '#a855f7',
    description: 'قوی‌ترین گلوله حرارتی با +۶۰٪ تخریب مرگبار و شعاع انفجار گسترده (مهمات نامحدود)',
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
  { biome: 'desert', title: 'صحرای طلایی · طوفان شن' },
  { biome: 'snow', title: 'ارتفاعات برفی · کولاک کوهستان' },
  { biome: 'industrial', title: 'منطقه صنعتی · باران اسیدی' },
  { biome: 'volcanic', title: 'دره آتشفشانی · بارش خاکستر' },
  { biome: 'night', title: 'پایگاه راداری شبانه · مه جنگی' },
];

/**
 * Generates a unique, larger 3D battlefield map for each stage with hills, obstacles, and supply crates.
 */
export function generateBattlefieldConfig(seed: number = Date.now(), stageNumber: number = 1): BattlefieldConfig {
  const rng = seededRandom(seed + stageNumber * 7919);
  const biomeEntry = BIOME_LIST[(stageNumber - 1) % BIOME_LIST.length];

  // Larger battlefield distance: 54m to 76m
  const distance = Math.round(54 + rng() * 20 + Math.min(10, stageNumber * 1.2));
  const leftHillHeight = Number(((rng() - 0.35) * 4.8).toFixed(2));
  const rightHillHeight = Number(((rng() - 0.35) * 4.8).toFixed(2));
  const centerRidgeHeight = Number((0.8 + rng() * 3.4).toFixed(2));
  const centerRidgeX = Number(((rng() - 0.5) * 14).toFixed(2));
  const roughnessFreq = Number((0.12 + rng() * 0.08).toFixed(3));
  const roughnessAmp = Number((0.28 + rng() * 0.38).toFixed(2));

  const tempArena: BattlefieldConfig = {
    seed,
    stageNumber,
    biome: biomeEntry.biome,
    biomeTitle: biomeEntry.title,
    distance,
    leftHillHeight,
    rightHillHeight,
    centerRidgeHeight,
    centerRidgeX,
    roughnessFreq,
    roughnessAmp,
    obstacles: [],
    crates: [],
  };

  // Spawn 3 to 4 destructible battlefield obstacles in the middle zone
  const obstacleKinds: DestructibleObstacle['kind'][] = ['bunker', 'fuel_tank', 'rock', 'wall'];
  const count = 3 + (rng() > 0.45 ? 1 : 0);
  const span = distance * 0.46;
  const obstacles: DestructibleObstacle[] = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    const ox = Number((t * span + (rng() - 0.5) * 4.5).toFixed(2));
    const oz = Number(((rng() - 0.5) * 3.2).toFixed(2));
    const kind = obstacleKinds[Math.floor(rng() * obstacleKinds.length)];
    const oy = terrainHeightAt(ox, tempArena);

    let width = 2.4;
    let height = 2.4;
    let depth = 2.4;
    let maxHp = 75;

    if (kind === 'fuel_tank') {
      width = 1.8;
      height = 2.2;
      depth = 1.8;
      maxHp = 45;
    } else if (kind === 'bunker') {
      width = 3.2;
      height = 2.8;
      depth = 3.0;
      maxHp = 110;
    } else if (kind === 'wall') {
      width = 2.2;
      height = 3.4;
      depth = 3.6;
      maxHp = 130;
    } else {
      width = 2.8;
      height = 2.6;
      depth = 2.6;
      maxHp = 95;
    }

    obstacles.push({
      id: `obs-${i}-${Math.floor(rng() * 10000)}`,
      kind,
      x: ox,
      y: oy,
      z: oz,
      width,
      height,
      depth,
      hp: maxHp,
      maxHp,
      destroyed: false,
    });
  }

  // Spawn 2 Supply Crates (1 First-Aid Heal Crate near player's driving range + 1 Gold Coin Crate in midfield)
  const halfDist = distance * 0.5;
  const healCrateX = Number((-halfDist + 4.2 + rng() * 3.2).toFixed(2));
  const coinCrateX = Number(((rng() - 0.5) * (distance * 0.35)).toFixed(2));

  const crates: SupplyCrate[] = [
    {
      id: `crate-heal-${stageNumber}`,
      kind: 'heal',
      x: healCrateX,
      y: terrainHeightAt(healCrateX, tempArena),
      z: Number(((rng() - 0.5) * 2.4).toFixed(2)),
      collected: false,
      value: 25, // +25% HP
    },
    {
      id: `crate-coin-${stageNumber}`,
      kind: 'coins',
      x: coinCrateX,
      y: terrainHeightAt(coinCrateX, tempArena),
      z: Number(((rng() - 0.5) * 2.4).toFixed(2)),
      collected: false,
      value: 55 + stageNumber * 10, // Bonus coins
    },
  ];

  tempArena.obstacles = obstacles;
  tempArena.crates = crates;
  return tempArena;
}

/**
 * Evaluates terrain elevation y at horizontal coordinate x.
 */
export function terrainHeightAt(x: number, arena: BattlefieldConfig): number {
  const halfDist = arena.distance * 0.5;

  const leftDist = x - -halfDist;
  const leftHill = arena.leftHillHeight * Math.exp(-(leftDist * leftDist) / 75);

  const rightDist = x - halfDist;
  const rightHill = arena.rightHillHeight * Math.exp(-(rightDist * rightDist) / 75);

  const centerDist = x - arena.centerRidgeX;
  const centerRidge = arena.centerRidgeHeight * Math.exp(-(centerDist * centerDist) / 95);

  // Smooth out micro-roughness directly under the tank spawn zones
  const platformMask =
    1 -
    0.75 * Math.exp(-(leftDist * leftDist) / 22) -
    0.75 * Math.exp(-(rightDist * rightDist) / 22);
  const microRoughness =
    Math.sin(x * arena.roughnessFreq) *
    Math.cos(x * arena.roughnessFreq * 0.63) *
    arena.roughnessAmp *
    Math.max(0, platformMask);

  return leftHill + rightHill + centerRidge + microRoughness;
}

/**
 * Computes terrain slope angle (in radians) at x so the tank hull tilts naturally on uneven slopes.
 */
export function terrainSlopeAt(x: number, arena: BattlefieldConfig): number {
  const delta = 0.6;
  const y1 = terrainHeightAt(x - delta, arena);
  const y2 = terrainHeightAt(x + delta, arena);
  return Math.atan2(y2 - y1, delta * 2);
}

/**
 * Generates dynamic wind speed in [-10, +10] m/s for the current turn.
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
 * Returns the world 3D coordinates of the tank's cannon muzzle tip.
 */
export function getTankMuzzleOrigin(tank: TankCombatState): { x: number; y: number; z: number } {
  const angleRad = (tank.barrelAngleDeg * Math.PI) / 180;
  const dir = tank.facing;
  const scale = tank.model.scale;
  const turretPivotY = tank.y + 1.45 * scale;
  const barrelLen = 3.1 * scale;

  const mx = tank.x + dir * Math.cos(angleRad) * barrelLen * Math.cos(tank.turretYawRad);
  const my = turretPivotY + Math.sin(angleRad) * barrelLen;
  const mz = tank.z + Math.cos(angleRad) * barrelLen * Math.sin(tank.turretYawRad);
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
  const nextVz = state.vz * (1 - 0.05 * dt);

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
  const dir = tank.facing;

  let current: TrajectoryPoint = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    vx: dir * speed * Math.cos(angleRad) * Math.cos(tank.turretYawRad),
    vy: speed * Math.sin(angleRad),
    vz: speed * Math.cos(angleRad) * Math.sin(tank.turretYawRad),
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
 * Checks 3D localized tank hitboxes:
 * - Turret / Weakspot ('turret'): Critical Damage (38% to 52% base HP, scaled by shell & tank power)
 * - Main Hull ('hull'): Medium Damage (24% to 34% base HP)
 * - Tracks / Wheels ('tracks'): Lower Damage (14% to 20% base HP + slows movement next turn)
 */
export function checkTankHitbox(
  px: number,
  py: number,
  pz: number,
  tank: TankCombatState,
  attacker: TankCombatState
): { hitZone: HitZone; damage: number } | null {
  if (py < tank.y - 0.3 || py > tank.y + 3.2 * tank.model.scale) return null;

  const s = tank.model.scale;
  const dx = Math.abs(px - tank.x);
  const dz = Math.abs(pz - tank.z);

  // Check Z depth tolerance (tank width + shell blast proximity)
  const zLimit = 1.85 * s + (attacker.shell.blastRadius - 2.2) * 0.35;
  if (dz > zLimit) return null;

  const relY = (py - tank.y) / s;
  const combatRatio =
    (attacker.model.damageMultiplier * attacker.shell.damageMultiplier) /
    Math.max(0.8, tank.model.armorMultiplier);

  // 1. Turret / Cupola Weakspot: relY in [1.28, 2.35], horizontal radius <= 1.45 * s
  if (relY >= 1.28 && relY <= 2.35 && dx <= 1.45 * s) {
    const centerFactor = 1 - Math.min(1, dx / (1.45 * s));
    const rawDamage = (38 + centerFactor * 14) * combatRatio;
    return { hitZone: 'turret', damage: Math.round(Math.max(25, Math.min(95, rawDamage))) };
  }

  // 2. Main Armored Hull: relY in [0.62, 1.28), horizontal half-length <= 2.35 * s
  if (relY >= 0.62 && relY < 1.28 && dx <= 2.35 * s) {
    const centerFactor = 1 - Math.min(1, dx / (2.35 * s));
    const rawDamage = (24 + centerFactor * 10) * combatRatio;
    return { hitZone: 'hull', damage: Math.round(Math.max(16, Math.min(65, rawDamage))) };
  }

  // 3. Tracks & Roadwheels: relY in [0.0, 0.62), horizontal half-length <= 2.55 * s
  if (relY >= 0.0 && relY < 0.62 && dx <= 2.55 * s) {
    const centerFactor = 1 - Math.min(1, dx / (2.55 * s));
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
      Math.abs(px - crate.x) <= 1.35 &&
      py >= crate.y - 0.2 &&
      py <= crate.y + 1.8 &&
      Math.abs(pz - crate.z) <= 1.6
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
        damage: Math.round(45 * shooter.shell.damageMultiplier * shooter.model.damageMultiplier),
        impactPoint: { x: px, y: py, z: pz },
      };
    }
  }

  // 4. Check Ground Terrain + Splash Damage near Opponent Tank
  const groundY = terrainHeightAt(px, arena);
  if (py <= groundY) {
    // Check if shell blast radius splashes a nearby tank's tracks
    for (const tank of tanks) {
      if (tank.hp <= 0) continue;
      if (tank.id === shooterId && elapsedTime < 0.25) continue;
      const distToTank = Math.hypot(px - tank.x, pz - tank.z);
      if (distToTank <= shooter.shell.blastRadius + 1.1) {
        const splashFactor = Math.max(0.35, 1 - distToTank / (shooter.shell.blastRadius + 1.4));
        const splashDmg = Math.round(16 * splashFactor * shooter.shell.damageMultiplier);
        return {
          hitType: 'tank',
          targetTankId: tank.id,
          hitZone: 'tracks',
          damage: Math.max(8, splashDmg),
          impactPoint: { x: px, y: groundY, z: pz },
        };
      }
    }

    return {
      hitType: 'ground',
      impactPoint: { x: px, y: groundY, z: pz },
    };
  }

  return {
    hitType: 'none',
    impactPoint: { x: px, y: py, z: pz },
  };
}

/**
 * Simulates an entire shell flight for AI trajectory planning.
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
  const dir = testShooter.facing;

  let current: TrajectoryPoint = {
    x: origin.x,
    y: origin.y,
    z: origin.z,
    vx: dir * speed * Math.cos(angleRad) * Math.cos(testShooter.turretYawRad),
    vy: speed * Math.sin(angleRad),
    vz: speed * Math.cos(angleRad) * Math.sin(testShooter.turretYawRad),
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

    if (Math.abs(current.x) > arena.distance * 1.4 || current.y < -30) {
      return {
        path,
        result: {
          hitType: 'ground',
          impactPoint: { x: current.x, y: terrainHeightAt(current.x, arena), z: current.z },
        },
      };
    }
  }

  return {
    path,
    result: {
      hitType: 'ground',
      impactPoint: { x: current.x, y: terrainHeightAt(current.x, arena), z: current.z },
    },
  };
}

/**
 * Selects the enemy tank model and AI accuracy scaling based on the current stage number
 * and the player's chosen tank so the enemy is comparable at Stage 1 and progressively stronger each stage.
 */
export function selectEnemyTankForStage(playerTankIndex: number, stageNumber: number): TankModelSpec {
  const targetIndex = Math.min(
    TANK_CATALOG.length - 1,
    Math.max(playerTankIndex, Math.floor((stageNumber - 1) * 0.85) + Math.min(2, playerTankIndex))
  );
  return TANK_CATALOG[targetIndex];
}

/**
 * Computes AI tank movement (repositioning to dodge) and ballistic cannon shot for the current stage.
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

  // 1. Tactical movement: AI moves slightly forward/backward and sideways each turn
  const maxStep = Math.min(aiTank.moveFuel, 2.8);
  const moveDeltaX = Number(((rng() - 0.5) * 2 * maxStep * 0.75).toFixed(2));
  const moveDeltaZ = Number(((rng() - 0.5) * 2 * Math.min(1.6, maxStep * 0.45)).toFixed(2));

  const movedAi: TankCombatState = {
    ...aiTank,
    x: aiTank.x + moveDeltaX,
    z: Math.max(-4.5, Math.min(4.5, aiTank.z + moveDeltaZ)),
  };
  movedAi.y = terrainHeightAt(movedAi.x, arena);

  const turretYawRad = Math.atan2(playerTank.z - movedAi.z, Math.abs(playerTank.x - movedAi.x));
  movedAi.turretYawRad = turretYawRad;

  const targetX = playerTank.x;
  const targetY = playerTank.y + 1.25 * playerTank.model.scale;

  let bestAngle = 38;
  let bestPower = 72;
  let bestScore = Infinity;

  const candidateAngles = [22, 26, 30, 34, 38, 42, 46, 50, 55, 60, 65];
  for (const ang of candidateAngles) {
    for (let pwr = 32; pwr <= 98; pwr += 3) {
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
          sim.result.impactPoint.y - targetY
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

  // Stage-scaled error: Stage 1 has gentle jitter; higher stages become deadlier
  const accuracyFactor = Math.max(0.18, 1 - (stageNumber - 1) * 0.12);
  const angleJitter = (rng() * 2 - 1) * 5.5 * accuracyFactor;
  const powerJitter = (rng() * 2 - 1) * 7.5 * accuracyFactor;

  return {
    moveDeltaX,
    moveDeltaZ,
    barrelAngleDeg: Math.round(Math.max(8, Math.min(75, bestAngle + angleJitter))),
    powerPct: Math.round(Math.max(22, Math.min(100, bestPower + powerJitter))),
    turretYawRad,
  };
}
