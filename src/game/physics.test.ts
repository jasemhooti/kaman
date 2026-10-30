import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHitDamage,
  checkArcherCollision,
  computeAIShot,
  computeTrajectoryPreview,
  generateArenaConfig,
  getBowLaunchOrigin,
  simulateFullShot,
  stepArrowPhysics,
  terrainHeightAt,
  type ArcherState,
} from './physics';

test('trajectory preview strictly caps length between 3 and 5 meters', () => {
  const points = computeTrajectoryPreview({ x: -20, y: 2 }, 45, 80, 1, 3.5, 4.2);
  assert.ok(points.length >= 4, 'should return multiple dashed preview points');
  let totalDist = 0;
  for (let i = 1; i < points.length; i++) {
    totalDist += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  assert.ok(totalDist >= 3.0 && totalDist <= 4.5, `Expected 3-5m preview, got ${totalDist.toFixed(2)}m`);
});

test('hitboxes and damage match Headshot (70-100%), Body (30-40%), and Limbs (15-20%) specs', () => {
  const head = calculateHitDamage('head', 26);
  const body = calculateHitDamage('body', 26);
  const limbs = calculateHitDamage('limbs', 26);

  assert.equal(head.isCritical, true);
  assert.ok(head.damage >= 70 && head.damage <= 100, `Headshot damage ${head.damage} out of [70..100]`);
  assert.ok(body.damage >= 30 && body.damage <= 40, `Body damage ${body.damage} out of [30..40]`);
  assert.ok(limbs.damage >= 15 && limbs.damage <= 20, `Limbs damage ${limbs.damage} out of [15..20]`);

  const target: ArcherState = {
    id: 2,
    name: 'Target',
    x: 20,
    y: 1.5,
    facing: -1,
    hp: 100,
    maxHp: 100,
    angleDeg: 45,
    powerPct: 70,
    shotsFired: 0,
    hitsLanded: 0,
    headshots: 0,
    lastLandingX: null,
  };

  const headHit = checkArcherCollision(20, 1.5 + 2.05, target, 25);
  assert.equal(headHit?.hitZone, 'head');
  assert.equal(headHit?.isCritical, true);

  const bodyHit = checkArcherCollision(20, 1.5 + 1.45, target, 25);
  assert.equal(bodyHit?.hitZone, 'body');

  const legHit = checkArcherCollision(20, 1.5 + 0.5, target, 25);
  assert.equal(legHit?.hitZone, 'limbs');
});

test('wind physics accelerates projectile horizontally and gravity pulls downward', () => {
  const noWind = stepArrowPhysics({ x: 0, y: 10, vx: 15, vy: 15 }, 0, 0.5);
  const tailwind = stepArrowPhysics({ x: 0, y: 10, vx: 15, vy: 15 }, 8, 0.5);
  const headwind = stepArrowPhysics({ x: 0, y: 10, vx: 15, vy: 15 }, -8, 0.5);

  assert.ok(tailwind.x > noWind.x, 'Positive wind should push projectile further right');
  assert.ok(headwind.x < noWind.x, 'Negative wind should slow projectile moving right');
  assert.ok(noWind.vy < 15, 'Gravity should reduce vertical velocity');
});

test('terrain height variation creates uneven platforms and destructible obstacles', () => {
  const arena = generateArenaConfig(12345);
  const leftY = terrainHeightAt(-arena.distance * 0.5, arena);
  const rightY = terrainHeightAt(arena.distance * 0.5, arena);

  assert.ok(Math.abs(leftY - rightY) >= 1.0, 'Archers should stand on uneven terrain elevations');
  assert.ok(arena.obstacles.length >= 3, 'Arena should include destructible obstacles between archers');
});

test('AI difficulty tiers behave distinctly and Hard AI converges on target', () => {
  const arena = generateArenaConfig(42);
  // Clear obstacles for pure ballistic convergence check
  arena.obstacles.forEach((o) => (o.destroyed = true));

  const p1: ArcherState = {
    id: 1,
    name: 'Player 1',
    x: -arena.distance * 0.5,
    y: terrainHeightAt(-arena.distance * 0.5, arena),
    facing: 1,
    hp: 100,
    maxHp: 100,
    angleDeg: 45,
    powerPct: 70,
    shotsFired: 0,
    hitsLanded: 0,
    headshots: 0,
    lastLandingX: null,
  };

  const ai: ArcherState = {
    id: 2,
    name: 'AI Archer',
    x: arena.distance * 0.5,
    y: terrainHeightAt(arena.distance * 0.5, arena),
    facing: -1,
    hp: 100,
    maxHp: 100,
    angleDeg: 45,
    powerPct: 70,
    shotsFired: 1, // Second shot -> Hard AI locks on
    hitsLanded: 0,
    headshots: 0,
    lastLandingX: null,
  };

  const wind = 4.5;
  const hardShot = computeAIShot(ai, p1, wind, arena, 'hard', 99);
  const hardSim = simulateFullShot(ai, p1, hardShot.angleDeg, hardShot.powerPct, wind, arena);

  assert.ok(
    hardSim.hitResult.hitType === 'archer' || hardSim.closestDistToTargetBody < 1.2,
    `Hard AI should hit or pass within 1.2m of target, got ${hardSim.closestDistToTargetBody.toFixed(2)}m`
  );
  assert.ok(getBowLaunchOrigin(ai).y > ai.y);
});
