import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TANK_CATALOG,
  SHELL_CATALOG,
  TRAJECTORY_PREVIEW_MAX_METERS,
  checkTankHitbox,
  computeAITankTurn,
  computeShortTrajectoryPreview,
  generateBattlefieldConfig,
  selectEnemyTankForStage,
  stepProjectile,
  terrainHeightAt,
  type TankCombatState,
} from './physics.ts';

function createDummyTank(id: 1 | 2, x: number, y: number, modelIdx = 0, shellIdx = 0): TankCombatState {
  const model = TANK_CATALOG[modelIdx];
  const shell = SHELL_CATALOG[shellIdx];
  return {
    id,
    name: id === 1 ? 'تانک بازیکن' : 'تانک دشمن',
    model,
    shell,
    x,
    y,
    z: 0,
    slopeAngle: 0,
    facing: id === 1 ? 1 : -1,
    turretYawRad: 0,
    barrelAngleDeg: 40,
    powerPct: 75,
    hp: 100,
    maxHp: 100,
    moveFuel: model.moveFuelMax,
    maxMoveFuel: model.moveFuelMax,
    tracksDamaged: false,
    shotsFired: 0,
    hitsLanded: 0,
    critHits: 0,
    lastLandingX: null,
  };
}

test('Tank catalog has 10 models with 3 free unlocked and 7 escalating coin prices', () => {
  assert.equal(TANK_CATALOG.length, 10);
  const freeTanks = TANK_CATALOG.filter((t) => t.price === 0);
  assert.equal(freeTanks.length, 3);

  for (let i = 3; i < TANK_CATALOG.length; i++) {
    assert.ok(TANK_CATALOG[i].price > TANK_CATALOG[i - 1].price, 'Tank prices should strictly increase');
  }
  assert.equal(SHELL_CATALOG.length, 4);
  assert.equal(SHELL_CATALOG[0].price, 0);
});

test('Short trajectory preview next to tank barrel strictly stays between 3 and 5 meters', () => {
  const tank = createDummyTank(1, -28, 1.5);
  const points = computeShortTrajectoryPreview(tank, 4.5, TRAJECTORY_PREVIEW_MAX_METERS);
  assert.ok(points.length >= 2);

  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
      points[i].z - points[i - 1].z
    );
  }
  assert.ok(length >= 3.0 && length <= 5.01, `Expected 3..5m preview length, got ${length}`);
});

test('Tank hitboxes distinguish Turret (critical), Hull (medium), and Tracks (low damage)', () => {
  const target = createDummyTank(2, 28, 0, 0, 0);
  const attacker = createDummyTank(1, -28, 0, 0, 0);

  const turretHit = checkTankHitbox(28, 1.75, 0, target, attacker);
  assert.ok(turretHit);
  assert.equal(turretHit.hitZone, 'turret');

  const hullHit = checkTankHitbox(28, 0.95, 0, target, attacker);
  assert.ok(hullHit);
  assert.equal(hullHit.hitZone, 'hull');

  const tracksHit = checkTankHitbox(28, 0.3, 0, target, attacker);
  assert.ok(tracksHit);
  assert.equal(tracksHit.hitZone, 'tracks');

  assert.ok(turretHit.damage > hullHit.damage);
  assert.ok(hullHit.damage > tracksHit.damage);
});

test('Battlefield generator creates distinct stage biomes, obstacles, and supply crates', () => {
  const stage1 = generateBattlefieldConfig(101, 1);
  const stage2 = generateBattlefieldConfig(101, 2);

  assert.notEqual(stage1.biome, stage2.biome);
  assert.ok(stage1.distance >= 54);
  assert.ok(stage1.obstacles.length >= 3);
  assert.equal(stage1.crates.length, 2);

  const yLeft = terrainHeightAt(-stage1.distance * 0.5, stage1);
  const yCenter = terrainHeightAt(0, stage1);
  assert.notEqual(yLeft, yCenter);
});

test('Enemy tank selection and AI ballistic solver scale with stage progression', () => {
  const enemyStage1 = selectEnemyTankForStage(0, 1);
  const enemyStage6 = selectEnemyTankForStage(0, 6);
  assert.ok(enemyStage6.index > enemyStage1.index);

  const arena = generateBattlefieldConfig(2026, 3);
  const p1 = createDummyTank(1, -arena.distance * 0.5, terrainHeightAt(-arena.distance * 0.5, arena));
  const ai = createDummyTank(2, arena.distance * 0.5, terrainHeightAt(arena.distance * 0.5, arena), enemyStage6.index);

  const decision = computeAITankTurn(ai, p1, -3.5, arena, 5, 999);
  assert.ok(decision.barrelAngleDeg >= 8 && decision.barrelAngleDeg <= 75);
  assert.ok(decision.powerPct >= 22 && decision.powerPct <= 100);

  const p0 = { x: 0, y: 10, z: 0, vx: 20, vy: 12, vz: 0, t: 0 };
  const pNext = stepProjectile(p0, 0.1, 6.0);
  assert.ok(pNext.vx > p0.vx);
  assert.ok(pNext.vy < p0.vy);
});
