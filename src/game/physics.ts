export type GameMode = '1p' | '2p';
export type AIDifficulty = 'easy' | 'medium' | 'hard';
export type WeatherType = 'clear' | 'dust' | 'rain';
export type HitZone = 'head' | 'body' | 'limbs';
export type ObstacleKind = 'barrel' | 'stone' | 'wall';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DestructibleObstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number; // bottom center Y on terrain
  width: number;
  height: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface ArcherState {
  id: 1 | 2;
  name: string;
  x: number;
  y: number; // ground elevation at archer's feet
  facing: 1 | -1; // 1 = facing right (+X), -1 = facing left (-X)
  hp: number;
  maxHp: number;
  angleDeg: number; // 5 to 85 degrees
  powerPct: number; // 15 to 100 percent
  shotsFired: number;
  hitsLanded: number;
  headshots: number;
  lastLandingX: number | null;
}

export interface ArenaConfig {
  seed: number;
  distance: number;
  leftHillHeight: number;
  rightHillHeight: number;
  valleyDepth: number;
  ridgeCenterOffset: number;
  ridgeHeight: number;
  obstacles: DestructibleObstacle[];
}

export interface ArrowStepResult {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angleRad: number;
}

export interface HitDetectionResult {
  hitType: 'none' | 'terrain' | 'obstacle' | 'archer';
  hitZone?: HitZone;
  damage?: number;
  isCritical?: boolean;
  targetArcherId?: 1 | 2;
  obstacleId?: string;
  impactPoint: { x: number; y: number };
}

export const GRAVITY = 9.81;
export const MIN_VELOCITY = 10;
export const MAX_VELOCITY = 33;
// Wind acceleration coefficient: windSpeed (-10..+10 m/s) applies horizontal acceleration
export const WIND_ACCEL_FACTOR = 0.52;

// Archer hitbox dimensions (pivot at bottom-center y = archer.y)
export const ARCHER_TOTAL_HEIGHT = 2.35;
export const ARCHER_LIMB_TOP = 1.05; // 0.0 to 1.05m = legs/lower limbs
export const ARCHER_BODY_TOP = 1.82; // 1.05 to 1.82m = torso/chest (plus arms on outer radius)
export const ARCHER_HEAD_TOP = 2.38; // 1.82 to 2.38m = head
export const ARCHER_BOW_OFFSET_Y = 1.52;
export const ARCHER_BOW_OFFSET_X = 0.45;

/**
 * Deterministic pseudo-random generator for reproducible arena seeds & unit tests
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert power percentage (0..100) to initial launch speed (m/s)
 */
export function powerToSpeed(powerPct: number): number {
  const clamped = Math.max(10, Math.min(100, powerPct));
  return MIN_VELOCITY + ((clamped - 10) / 90) * (MAX_VELOCITY - MIN_VELOCITY);
}

/**
 * Compute continuous ground elevation at world coordinate X
 */
export function terrainHeightAt(x: number, arena: ArenaConfig): number {
  const halfDist = arena.distance * 0.5;

  // Left platform plateau around -halfDist
  const leftDist = Math.abs(x - -halfDist);
  const leftPlateau = Math.exp(-Math.pow(leftDist / 5.2, 2)) * arena.leftHillHeight;

  // Right platform plateau around +halfDist
  const rightDist = Math.abs(x - halfDist);
  const rightPlateau = Math.exp(-Math.pow(rightDist / 5.2, 2)) * arena.rightHillHeight;

  // Central ridge or valley between platforms
  const centerDist = Math.abs(x - arena.ridgeCenterOffset);
  const centerRidge = Math.exp(-Math.pow(centerDist / 6.5, 2)) * arena.ridgeHeight;

  // Gentle rolling dunes/rocky floor
  const undulation =
    Math.sin(x * 0.19 + arena.seed * 0.1) * 0.35 +
    Math.cos(x * 0.08 - arena.seed * 0.05) * 0.25;

  // Flatten directly under the archers' feet (1.8m radius) so they stand flush
  const leftFlatFactor = Math.min(1, Math.max(0, (leftDist - 1.6) / 2.5));
  const rightFlatFactor = Math.min(1, Math.max(0, (rightDist - 1.6) / 2.5));
  const flatMask = leftFlatFactor * rightFlatFactor;

  return leftPlateau + rightPlateau + (centerRidge + undulation - arena.valleyDepth * 0.3) * flatMask;
}

/**
 * Generate a complete arena with uneven terrain heights and destructible obstacles
 */
export function generateArenaConfig(seed = Date.now()): ArenaConfig {
  const rand = mulberry32(seed);
  const distance = 38 + rand() * 12; // 38m to 50m between archers
  const leftHillHeight = -1.0 + rand() * 4.8; // -1.0m to +3.8m
  const rightHillHeight = -1.0 + rand() * 4.8;
  // Ensure noticeable height difference (at least 1.4m difference) for interesting angle math
  const adjustedRightHeight =
    Math.abs(rightHillHeight - leftHillHeight) < 1.4
      ? leftHillHeight + (rand() > 0.5 ? 2.2 : -1.8)
      : rightHillHeight;

  const valleyDepth = 0.5 + rand() * 1.5;
  const ridgeCenterOffset = (rand() - 0.5) * 8;
  const ridgeHeight = -0.6 + rand() * 2.8;

  const tempArena: ArenaConfig = {
    seed,
    distance,
    leftHillHeight,
    rightHillHeight: adjustedRightHeight,
    valleyDepth,
    ridgeCenterOffset,
    ridgeHeight,
    obstacles: [],
  };

  const obstacleSpecs: Array<{
    kind: ObstacleKind;
    xRatio: number;
    width: number;
    height: number;
    hp: number;
  }> = [
    {
      kind: 'barrel',
      xRatio: -0.22 + (rand() - 0.5) * 0.06,
      width: 1.15,
      height: 1.55,
      hp: 35,
    },
    {
      kind: 'wall',
      xRatio: 0.0 + (rand() - 0.5) * 0.08,
      width: 1.5,
      height: 3.1,
      hp: 90,
    },
    {
      kind: 'stone',
      xRatio: 0.22 + (rand() - 0.5) * 0.06,
      width: 1.35,
      height: 2.1,
      hp: 65,
    },
  ];

  // Optionally add a 4th barrel near one of the fortifications
  if (rand() > 0.35) {
    obstacleSpecs.push({
      kind: 'barrel',
      xRatio: (rand() > 0.5 ? 0.11 : -0.11),
      width: 1.1,
      height: 1.45,
      hp: 35,
    });
  }

  tempArena.obstacles = obstacleSpecs.map((spec, idx) => {
    const x = spec.xRatio * distance;
    const y = terrainHeightAt(x, tempArena);
    return {
      id: `obs-${idx}-${spec.kind}`,
      kind: spec.kind,
      x,
      y,
      width: spec.width,
      height: spec.height,
      hp: spec.hp,
      maxHp: spec.hp,
      destroyed: false,
    };
  });

  return tempArena;
}

/**
 * Get the world coordinates where an archer's arrow spawns
 */
export function getBowLaunchOrigin(archer: ArcherState): { x: number; y: number } {
  return {
    x: archer.x + archer.facing * ARCHER_BOW_OFFSET_X,
    y: archer.y + ARCHER_BOW_OFFSET_Y,
  };
}

/**
 * Advance arrow state by time step dt under gravity and horizontal wind
 */
export function stepArrowPhysics(
  state: { x: number; y: number; vx: number; vy: number },
  windSpeed: number,
  dt: number
): ArrowStepResult {
  const ax = windSpeed * WIND_ACCEL_FACTOR;
  const ay = -GRAVITY;

  const nextVx = state.vx + ax * dt;
  const nextVy = state.vy + ay * dt;
  const nextX = state.x + state.vx * dt + 0.5 * ax * dt * dt;
  const nextY = state.y + state.vy * dt + 0.5 * ay * dt * dt;
  const angleRad = Math.atan2(nextVy, nextVx);

  return {
    x: nextX,
    y: nextY,
    vx: nextVx,
    vy: nextVy,
    angleRad,
  };
}

/**
 * Compute short dashed trajectory preview (strictly limited to 3.5 - 4.5 meters
 * so it reveals initial launch angle & wind push without spoiling landing point)
 */
export function computeTrajectoryPreview(
  origin: { x: number; y: number },
  angleDeg: number,
  powerPct: number,
  facing: 1 | -1,
  windSpeed: number,
  maxPreviewMeters = 4.2
): Array<{ x: number; y: number }> {
  const speed = powerToSpeed(powerPct);
  const rad = (angleDeg * Math.PI) / 180;
  let state = {
    x: origin.x,
    y: origin.y,
    vx: Math.cos(rad) * speed * facing,
    vy: Math.sin(rad) * speed,
  };

  const points: Array<{ x: number; y: number }> = [{ x: state.x, y: state.y }];
  let traveled = 0;
  const dt = 0.018;

  for (let i = 0; i < 40; i++) {
    const next = stepArrowPhysics(state, windSpeed, dt);
    const segLen = Math.hypot(next.x - state.x, next.y - state.y);
    if (traveled + segLen >= maxPreviewMeters) {
      const remain = maxPreviewMeters - traveled;
      const ratio = segLen > 0.0001 ? remain / segLen : 0;
      points.push({
        x: state.x + (next.x - state.x) * ratio,
        y: state.y + (next.y - state.y) * ratio,
      });
      break;
    }
    traveled += segLen;
    points.push({ x: next.x, y: next.y });
    state = next;
  }

  return points;
}

/**
 * Calculate damage for a hit zone:
 * - Headshot: Critical 75 - 100% max HP (default 85 damage)
 * - Body (chest/torso): Medium 30 - 40% max HP (default 35 damage)
 * - Limbs (arms/legs): Low 15 - 20% max HP (default 18 damage)
 */
export function calculateHitDamage(zone: HitZone, velocityMagnitude = 22): {
  damage: number;
  isCritical: boolean;
} {
  const speedBonus = Math.max(0, Math.min(1, (velocityMagnitude - 12) / 22));
  if (zone === 'head') {
    const damage = Math.round(78 + speedBonus * 22); // 78 to 100 HP
    return { damage, isCritical: true };
  }
  if (zone === 'body') {
    const damage = Math.round(32 + speedBonus * 8); // 32 to 40 HP
    return { damage, isCritical: false };
  }
  const damage = Math.round(15 + speedBonus * 5); // 15 to 20 HP
  return { damage, isCritical: false };
}

/**
 * Check if a point (x, y) collides with an archer and classify HitZone (Head / Body / Limbs)
 */
export function checkArcherCollision(
  px: number,
  py: number,
  archer: ArcherState,
  velocityMagnitude = 22
): HitDetectionResult | null {
  if (archer.hp <= 0) return null;

  const dx = Math.abs(px - archer.x);
  const relY = py - archer.y;

  if (relY < 0 || relY > ARCHER_HEAD_TOP + 0.12) {
    return null;
  }

  // 1. Head hitbox: y in [1.82, 2.38], radius 0.34m
  if (relY >= ARCHER_BODY_TOP && relY <= ARCHER_HEAD_TOP + 0.08) {
    const headCenterY = 2.08;
    const distHead = Math.hypot(px - archer.x, relY - headCenterY);
    if (distHead <= 0.36) {
      const { damage, isCritical } = calculateHitDamage('head', velocityMagnitude);
      return {
        hitType: 'archer',
        hitZone: 'head',
        damage,
        isCritical,
        targetArcherId: archer.id,
        impactPoint: { x: px, y: py },
      };
    }
  }

  // 2. Upper body / chest vs outer arms: y in [1.05, 1.82]
  if (relY >= ARCHER_LIMB_TOP && relY < ARCHER_BODY_TOP) {
    // Inner torso core: dx <= 0.36m -> Body hit
    if (dx <= 0.36) {
      const { damage, isCritical } = calculateHitDamage('body', velocityMagnitude);
      return {
        hitType: 'archer',
        hitZone: 'body',
        damage,
        isCritical,
        targetArcherId: archer.id,
        impactPoint: { x: px, y: py },
      };
    }
    // Outer shoulder/arms/bow-arm zone: 0.36 < dx <= 0.62m -> Limbs hit
    if (dx <= 0.62) {
      const { damage, isCritical } = calculateHitDamage('limbs', velocityMagnitude);
      return {
        hitType: 'archer',
        hitZone: 'limbs',
        damage,
        isCritical,
        targetArcherId: archer.id,
        impactPoint: { x: px, y: py },
      };
    }
  }

  // 3. Lower limbs (legs): y in [0, 1.05], dx <= 0.44m -> Limbs hit
  if (relY >= 0 && relY < ARCHER_LIMB_TOP && dx <= 0.44) {
    const { damage, isCritical } = calculateHitDamage('limbs', velocityMagnitude);
    return {
      hitType: 'archer',
      hitZone: 'limbs',
      damage,
      isCritical,
      targetArcherId: archer.id,
      impactPoint: { x: px, y: py },
    };
  }

  return null;
}

/**
 * Sub-stepped segment collision check from (prevX, prevY) to (nextX, nextY)
 */
export function evaluateSegmentCollision(
  prevX: number,
  prevY: number,
  nextX: number,
  nextY: number,
  vx: number,
  vy: number,
  shooterId: 1 | 2,
  archers: [ArcherState, ArcherState],
  arena: ArenaConfig
): HitDetectionResult {
  const steps = 6;
  const speed = Math.hypot(vx, vy);

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = prevX + (nextX - prevX) * t;
    const y = prevY + (nextY - prevY) * t;

    // Check target archer first (and self only if arrow somehow blew backward after >0.5m)
    for (const archer of archers) {
      if (archer.id === shooterId && Math.abs(x - archer.x) < 0.9) continue;
      const archerHit = checkArcherCollision(x, y, archer, speed);
      if (archerHit) return archerHit;
    }

    // Check destructible obstacles
    for (const obs of arena.obstacles) {
      if (obs.destroyed) continue;
      const halfW = obs.width * 0.5;
      if (x >= obs.x - halfW && x <= obs.x + halfW && y >= obs.y && y <= obs.y + obs.height) {
        return {
          hitType: 'obstacle',
          obstacleId: obs.id,
          damage: Math.round(28 + (speed / MAX_VELOCITY) * 22),
          impactPoint: { x, y },
        };
      }
    }

    // Check terrain ground height
    const groundY = terrainHeightAt(x, arena);
    if (y <= groundY) {
      return {
        hitType: 'terrain',
        impactPoint: { x, y: groundY },
      };
    }
  }

  return {
    hitType: 'none',
    impactPoint: { x: nextX, y: nextY },
  };
}

/**
 * Simulate a complete shot to find where it lands or what it hits (used by AI and tests)
 */
export function simulateFullShot(
  shooter: ArcherState,
  target: ArcherState,
  angleDeg: number,
  powerPct: number,
  windSpeed: number,
  arena: ArenaConfig
): {
  hitResult: HitDetectionResult;
  closestDistToTargetHead: number;
  closestDistToTargetBody: number;
  landingX: number;
} {
  const origin = getBowLaunchOrigin(shooter);
  const speed = powerToSpeed(powerPct);
  const rad = (angleDeg * Math.PI) / 180;

  let state = {
    x: origin.x,
    y: origin.y,
    vx: Math.cos(rad) * speed * shooter.facing,
    vy: Math.sin(rad) * speed,
  };

  const dt = 0.025;
  let closestHead = Infinity;
  let closestBody = Infinity;
  const targetHeadY = target.y + 2.08;
  const targetBodyY = target.y + 1.45;

  for (let step = 0; step < 600; step++) {
    const next = stepArrowPhysics(state, windSpeed, dt);

    const dHead = Math.hypot(next.x - target.x, next.y - targetHeadY);
    const dBody = Math.hypot(next.x - target.x, next.y - targetBodyY);
    if (dHead < closestHead) closestHead = dHead;
    if (dBody < closestBody) closestBody = dBody;

    const collision = evaluateSegmentCollision(
      state.x,
      state.y,
      next.x,
      next.y,
      next.vx,
      next.vy,
      shooter.id,
      [shooter, target],
      arena
    );

    if (collision.hitType !== 'none') {
      return {
        hitResult: collision,
        closestDistToTargetHead: closestHead,
        closestDistToTargetBody: closestBody,
        landingX: collision.impactPoint.x,
      };
    }

    if (Math.abs(next.x) > arena.distance * 1.35 || next.y < -25) {
      return {
        hitResult: { hitType: 'terrain', impactPoint: { x: next.x, y: next.y } },
        closestDistToTargetHead: closestHead,
        closestDistToTargetBody: closestBody,
        landingX: next.x,
      };
    }

    state = next;
  }

  return {
    hitResult: { hitType: 'terrain', impactPoint: { x: state.x, y: state.y } },
    closestDistToTargetHead: closestHead,
    closestDistToTargetBody: closestBody,
    landingX: state.x,
  };
}

/**
 * AI Decision Engine for Easy, Medium, and Hard difficulties:
 * - Easy: High random error (±15° angle, ±25% power), ignores wind completely, misses first 3 shots.
 * - Medium: Moderate error (±6° angle, ±10% power), adapts from previous shot's miss offset.
 * - Hard: Full ballistic + wind simulation across both standard & high-arch trajectories;
 *   shot 1 lands threateningly close or grazes, shot 2+ locks onto headshot/body.
 */
export function computeAIShot(
  aiArcher: ArcherState,
  playerArcher: ArcherState,
  windSpeed: number,
  arena: ArenaConfig,
  difficulty: AIDifficulty,
  seed = Date.now()
): { angleDeg: number; powerPct: number; reasoningTag: string } {
  const rand = mulberry32(seed + aiArcher.shotsFired * 97);

  // 1. Find ideal ballistic solution (ignoring wind for Easy, including wind for Medium/Hard)
  const effectiveWind = difficulty === 'easy' ? 0 : windSpeed;

  let bestAngle = 42;
  let bestPower = 68;
  let bestScore = Infinity;

  // Search angle [18..76] (including Arch Shots over walls!) and power [30..98]
  const angleCandidates =
    difficulty === 'hard'
      ? [22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 66, 70, 74]
      : [25, 32, 38, 45, 52, 60, 68];
  const powerStep = difficulty === 'hard' ? 1.5 : 3.0;

  for (const ang of angleCandidates) {
    for (let pwr = 32; pwr <= 98; pwr += powerStep) {
      const sim = simulateFullShot(aiArcher, playerArcher, ang, pwr, effectiveWind, arena);

      // Direct hit on target archer is top priority
      if (sim.hitResult.hitType === 'archer' && sim.hitResult.targetArcherId === playerArcher.id) {
        const zoneBonus =
          sim.hitResult.hitZone === 'head'
            ? -50
            : sim.hitResult.hitZone === 'body'
              ? -25
              : -10;
        const score = zoneBonus + sim.closestDistToTargetHead;
        if (score < bestScore) {
          bestScore = score;
          bestAngle = ang;
          bestPower = pwr;
        }
      } else {
        // Otherwise score by closest approach to target body (penalizing early obstacle hits)
        const obsPenalty = sim.hitResult.hitType === 'obstacle' ? 12 : 0;
        const score = sim.closestDistToTargetBody + obsPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestAngle = ang;
          bestPower = pwr;
        }
      }
    }
  }

  // Refine around bestAngle / bestPower for Hard mode
  if (difficulty === 'hard') {
    for (let dA = -2.5; dA <= 2.5; dA += 0.5) {
      for (let dP = -2.0; dP <= 2.0; dP += 0.4) {
        const ang = Math.max(12, Math.min(82, bestAngle + dA));
        const pwr = Math.max(20, Math.min(100, bestPower + dP));
        const sim = simulateFullShot(aiArcher, playerArcher, ang, pwr, windSpeed, arena);
        if (sim.hitResult.hitType === 'archer' && sim.hitResult.targetArcherId === playerArcher.id) {
          const zoneBonus = sim.hitResult.hitZone === 'head' ? -80 : -40;
          const score = zoneBonus + sim.closestDistToTargetHead;
          if (score < bestScore) {
            bestScore = score;
            bestAngle = ang;
            bestPower = pwr;
          }
        }
      }
    }
  }

  // Apply difficulty-specific error profiles
  if (difficulty === 'easy') {
    // Easy: ±15° angle error, ±25% power error, ignores wind, misses first 3 shots
    let angleError = (rand() * 2 - 1) * 15;
    let powerError = (rand() * 2 - 1) * 25;
    if (aiArcher.shotsFired < 3 && Math.abs(angleError) < 6 && Math.abs(powerError) < 9) {
      // Ensure early shots in Easy mode have noticeable error so player has breathing room
      angleError = angleError >= 0 ? 9 + rand() * 6 : -9 - rand() * 6;
      powerError = powerError >= 0 ? 12 + rand() * 10 : -12 - rand() * 10;
    }
    return {
      angleDeg: Math.round(Math.max(10, Math.min(82, bestAngle + angleError))),
      powerPct: Math.round(Math.max(20, Math.min(100, bestPower + powerError))),
      reasoningTag: 'خطای تصادفی بالا · بدون محاسبه باد',
    };
  }

  if (difficulty === 'medium') {
    // Medium: ±6° and ±10% initial error, decays by 38% per shot as AI corrects from previous miss
    const decay = Math.pow(0.62, aiArcher.shotsFired);
    const angleError = (rand() * 2 - 1) * 6 * decay;
    const powerError = (rand() * 2 - 1) * 10 * decay;
    return {
      angleDeg: Math.round(Math.max(10, Math.min(82, bestAngle + angleError)) * 10) / 10,
      powerPct: Math.round(Math.max(20, Math.min(100, bestPower + powerError)) * 10) / 10,
      reasoningTag:
        aiArcher.shotsFired === 0
          ? 'تخمین اولیه فاصله و باد'
          : `تصحیح خطای نوبت قبل (نوبت ${aiArcher.shotsFired + 1})`,
    };
  }

  // Hard: Shot 0 is a near-hit / graze (±1.4° / ±2.2%), Shot 1+ is surgical headshot/body lock
  const isFirstShot = aiArcher.shotsFired === 0;
  const hardAngleJitter = isFirstShot ? (rand() > 0.5 ? 1.3 : -1.3) : (rand() * 2 - 1) * 0.35;
  const hardPowerJitter = isFirstShot ? (rand() > 0.5 ? 2.0 : -2.0) : (rand() * 2 - 1) * 0.5;

  return {
    angleDeg: Math.round(Math.max(10, Math.min(82, bestAngle + hardAngleJitter)) * 10) / 10,
    powerPct: Math.round(Math.max(20, Math.min(100, bestPower + hardPowerJitter)) * 10) / 10,
    reasoningTag: isFirstShot
      ? 'محاسبه دقیق بالستیک و کالیبراسیون باد'
      : 'قفل هدف روی نقطه بحرانی (Headshot Solver)',
  };
}

/**
 * Generate wind speed for a turn (-10.0 to +10.0 m/s)
 */
export function generateTurnWind(weather: WeatherType, seed = Date.now()): number {
  const rand = mulberry32(seed);
  const maxWind = weather === 'dust' ? 10.0 : weather === 'rain' ? 8.5 : 6.5;
  const raw = (rand() * 2 - 1) * maxWind;
  return Math.round(raw * 10) / 10;
}
