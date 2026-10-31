/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  SHELL_CATALOG,
  TANK_CATALOG,
  computeAITankTurn,
  generateBattlefieldConfig,
   generateTurnWind,
  selectEnemyTankForStage,
  terrainHeightAt,
  terrainSlopeAt,
  type BattlefieldConfig,
  type CameraPreset,
  type HitDetectionResult,
  type ShellSpec,
  type TankCombatState,
  type TankModelSpec,
} from './game/physics';
import { ArenaCanvas, type ActiveShotTrigger } from './game/ArenaCanvas';
import { GameHud } from './components/GameHud';
import { soundEngine } from './game/sound';

type AppState = 'garage' | 'shop' | 'playing' | 'paused' | 'gameover';

interface SavedProgress {
  coins: number;
  stageNumber: number;
  unlockedTankIds: string[];
  unlockedShellIds: string[];
  selectedTankId: string;
  selectedShellId: string;
}

const STORAGE_KEY = 'ir_jasem_ply_tank_wars_v1';

function loadSavedProgress(): SavedProgress {
  const defaultSave: SavedProgress = {
    coins: 180,
    stageNumber: 1,
    unlockedTankIds: [TANK_CATALOG[0].id, TANK_CATALOG[1].id, TANK_CATALOG[2].id],
    unlockedShellIds: [SHELL_CATALOG[0].id],
    selectedTankId: TANK_CATALOG[0].id,
    selectedShellId: SHELL_CATALOG[0].id,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSave;
    const parsed = JSON.parse(raw);
    return {
      coins: typeof parsed.coins === 'number' ? parsed.coins : defaultSave.coins,
      stageNumber: typeof parsed.stageNumber === 'number' ? Math.max(1, parsed.stageNumber) : 1,
      unlockedTankIds: Array.isArray(parsed.unlockedTankIds)
        ? Array.from(new Set([...defaultSave.unlockedTankIds, ...parsed.unlockedTankIds]))
        : defaultSave.unlockedTankIds,
      unlockedShellIds: Array.isArray(parsed.unlockedShellIds)
        ? Array.from(new Set([...defaultSave.unlockedShellIds, ...parsed.unlockedShellIds]))
        : defaultSave.unlockedShellIds,
      selectedTankId: parsed.selectedTankId || defaultSave.selectedTankId,
      selectedShellId: parsed.selectedShellId || defaultSave.selectedShellId,
    };
  } catch {
    return defaultSave;
  }
}

interface MatchOutcome {
  victory: boolean;
  stageCleared: number;
  coinsEarned: number;
  enemyTankName: string;
  critHits: number;
}

function createStageTanks(
  arena: BattlefieldConfig,
  playerModel: TankModelSpec,
  playerShell: ShellSpec,
  stageNumber: number
): [TankCombatState, TankCombatState] {
  const halfDist = arena.distance * 0.5;
  const x1 = -halfDist;
  const x2 = halfDist;
  const y1 = terrainHeightAt(x1, arena);
  const y2 = terrainHeightAt(x2, arena);

  const enemyModel = selectEnemyTankForStage(playerModel.index, stageNumber);
  const enemyShellIndex = Math.min(
    SHELL_CATALOG.length - 1,
    Math.floor((stageNumber - 1) / 3)
  );
  const enemyShell = SHELL_CATALOG[enemyShellIndex];

  // Both tanks start with equal HP in each stage as requested
  const stageEqualHp = Math.round(100 + (stageNumber - 1) * 15);

  return [
    {
      id: 1,
      name: playerModel.name,
      model: playerModel,
      shell: playerShell,
      x: x1,
      y: y1,
      z: 0,
      slopeAngle: terrainSlopeAt(x1, arena),
      facing: 1,
      turretYawRad: 0,
      barrelAngleDeg: 36,
      powerPct: 72,
      hp: stageEqualHp,
      maxHp: stageEqualHp,
      moveFuel: playerModel.moveFuelMax,
      maxMoveFuel: playerModel.moveFuelMax,
      tracksDamaged: false,
      shotsFired: 0,
      hitsLanded: 0,
      critHits: 0,
      lastLandingX: null,
    },
    {
      id: 2,
      name: enemyModel.name,
      model: enemyModel,
      shell: enemyShell,
      x: x2,
      y: y2,
      z: 0,
      slopeAngle: terrainSlopeAt(x2, arena),
      facing: -1,
      turretYawRad: 0,
      barrelAngleDeg: 38,
      powerPct: 72,
      hp: stageEqualHp,
      maxHp: stageEqualHp,
      moveFuel: enemyModel.moveFuelMax,
      maxMoveFuel: enemyModel.moveFuelMax,
      tracksDamaged: false,
      shotsFired: 0,
      hitsLanded: 0,
      critHits: 0,
      lastLandingX: null,
    },
  ];
}

const CAMERA_PRESET_ORDER: CameraPreset[] = ['tactical', 'turret', 'side', 'drone', 'cinematic'];

export default function App() {
  const initialAutostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [progress, setProgress] = useState<SavedProgress>(() => loadSavedProgress());
  const [appState, setAppState] = useState<AppState>(initialAutostart ? 'playing' : 'garage');

  const selectedTank =
    TANK_CATALOG.find((t) => t.id === progress.selectedTankId) || TANK_CATALOG[0];
  const selectedShell =
    SHELL_CATALOG.find((s) => s.id === progress.selectedShellId) || SHELL_CATALOG[0];

  const [arena, setArena] = useState<BattlefieldConfig>(() =>
    generateBattlefieldConfig(2026, progress.stageNumber)
  );
  const [tanks, setTanks] = useState<[TankCombatState, TankCombatState]>(() =>
    createStageTanks(
      generateBattlefieldConfig(2026, progress.stageNumber),
      selectedTank,
      selectedShell,
      progress.stageNumber
    )
  );
  const [trailingHp, setTrailingHp] = useState<[number, number]>(() => [
    tanks[0].maxHp,
    tanks[1].maxHp,
  ]);

  const [currentTurn, setCurrentTurn] = useState<1 | 2>(1);
  const [turnCount, setTurnCount] = useState<number>(1);
  const [windSpeed, setWindSpeed] = useState<number>(() =>
    generateTurnWind(arena.biome, 2026)
  );
  const [isShotInFlight, setIsShotInFlight] = useState<boolean>(false);
  const [shotTrigger, setShotTrigger] = useState<ActiveShotTrigger | null>(null);

  const [lastImpactBanner, setLastImpactBanner] = useState<{
    text: string;
    subtext: string;
    tone: 'crit' | 'hit' | 'miss';
  } | null>(null);

  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('tactical');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [matchOutcome, setMatchOutcome] = useState<MatchOutcome | null>(null);

  const shotCounterRef = useRef<number>(1);
  const aiTimerRef = useRef<number | null>(null);
  const bannerTimerRef = useRef<number | null>(null);

  // Persist coins, stage, and unlocked tanks/shells to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Ignore storage errors
    }
  }, [progress]);

  // Sync document.body.dataset.state for automated testing
  useEffect(() => {
    document.body.dataset.state = appState;
  }, [appState]);

  const showBanner = useCallback(
    (text: string, subtext: string, tone: 'crit' | 'hit' | 'miss', durationMs = 2400) => {
      if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current);
      setLastImpactBanner({ text, subtext, tone });
      bannerTimerRef.current = window.setTimeout(() => {
        setLastImpactBanner(null);
      }, durationMs);
    },
    []
  );

  // Update 3D preview tank when browsing Garage or Shell Shop
  const previewTankInGarage = useCallback(
    (tankSpec: TankModelSpec, shellSpec: ShellSpec) => {
      setTanks((prev) => [
        {
          ...prev[0],
          name: tankSpec.name,
          model: tankSpec,
          shell: shellSpec,
        },
        prev[1],
      ]);
    },
    []
  );

  // Start or Launch Battle for a given Stage Number
  const startBattleStage = useCallback(
    (targetStage: number, customTank?: TankModelSpec, customShell?: ShellSpec) => {
      if (aiTimerRef.current) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }

      const activeTankModel = customTank || selectedTank;
      const activeShellModel = customShell || selectedShell;
      const seed = Date.now() + targetStage * 313;
      const nextArena = generateBattlefieldConfig(seed, targetStage);
      const nextTanks = createStageTanks(nextArena, activeTankModel, activeShellModel, targetStage);
      const nextWind = generateTurnWind(nextArena.biome, seed + 19);

      setArena(nextArena);
      setTanks(nextTanks);
      setTrailingHp([nextTanks[0].maxHp, nextTanks[1].maxHp]);
      setCurrentTurn(1);
      setTurnCount(1);
      setWindSpeed(nextWind);
      setIsShotInFlight(false);
      setShotTrigger(null);
      setMatchOutcome(null);
      setAppState('playing');

      showBanner(
        `مرحله ${targetStage} · ${nextArena.biomeTitle}`,
        `${activeTankModel.name} در برابر ${nextTanks[1].model.name}`,
        'hit',
        2200
      );
    },
    [selectedTank, selectedShell, showBanner]
  );

  // Select or Purchase a Tank in the Garage
  const handleSelectOrBuyTank = (tank: TankModelSpec) => {
    const isUnlocked = progress.unlockedTankIds.includes(tank.id);
    if (isUnlocked) {
      setProgress((prev) => ({ ...prev, selectedTankId: tank.id }));
      previewTankInGarage(tank, selectedShell);
      soundEngine.playTrackMove();
      return;
    }

    if (progress.coins >= tank.price) {
      soundEngine.playCratePickup();
      setProgress((prev) => ({
        ...prev,
        coins: prev.coins - tank.price,
        unlockedTankIds: [...prev.unlockedTankIds, tank.id],
        selectedTankId: tank.id,
      }));
      previewTankInGarage(tank, selectedShell);
    }
  };

  // Select or Purchase a Shell in the Shell Shop (Unlimited Ammo once unlocked!)
  const handleSelectOrBuyShell = (shell: ShellSpec) => {
    const isUnlocked = progress.unlockedShellIds.includes(shell.id);
    if (isUnlocked) {
      setProgress((prev) => ({ ...prev, selectedShellId: shell.id }));
      previewTankInGarage(selectedTank, shell);
      soundEngine.playTurretServo(80);
      return;
    }

    if (selectedTank.index < shell.minTankIndex) {
      return;
    }

    if (progress.coins >= shell.price) {
      soundEngine.playCratePickup();
      setProgress((prev) => ({
        ...prev,
        coins: prev.coins - shell.price,
        unlockedShellIds: [...prev.unlockedShellIds, shell.id],
        selectedShellId: shell.id,
      }));
      previewTankInGarage(selectedTank, shell);
    }
  };

  // Move Player Tank slightly Forward, Backward, Left, or Right during their turn
  const handleMoveTank = useCallback(
    (dx: number, dz: number) => {
      if (appState !== 'playing' || isShotInFlight || currentTurn !== 1) return;

      const stepCost = Math.hypot(dx, dz);
      setTanks((prev) => {
        const p1 = { ...prev[0] };
        if (p1.moveFuel < 0.1) return prev;

        const halfDist = arena.distance * 0.5;
        const minX = -halfDist - 8.5;
        const maxX = -6.0; // Keep player tank on their side of the valley
        const nextX = Math.max(minX, Math.min(maxX, p1.x + dx));
        const nextZ = Math.max(-4.8, Math.min(4.8, p1.z + dz));
        const nextY = terrainHeightAt(nextX, arena, nextZ);

        p1.x = nextX;
        p1.y = nextY;
        p1.z = nextZ;
        p1.slopeAngle = terrainSlopeAt(nextX, arena, nextZ);
        p1.moveFuel = Math.max(0, p1.moveFuel - stepCost);

        // Automatically orient turret yaw toward enemy tank Z
        p1.turretYawRad = Math.atan2(prev[1].z - nextZ, Math.abs(prev[1].x - nextX));

        // Check if driving over a Supply Crate!
        setArena((prevArena) => {
          let pickedUp = false;
          const nextCrates = prevArena.crates.map((crate) => {
            if (crate.collected) return crate;
            if (Math.hypot(nextX - crate.x, nextZ - crate.z) <= 2.3) {
              pickedUp = true;
              soundEngine.playCratePickup();
              if (crate.kind === 'heal') {
                const healAmt = Math.round(p1.maxHp * 0.25);
                p1.hp = Math.min(p1.maxHp, p1.hp + healAmt);
                setTrailingHp([p1.hp, prev[1].hp]);
                showBanner('جعبه تعمیر دریافت شد!', `+${healAmt} جان به تانک شما اضافه شد`, 'hit', 2000);
              } else {
                setProgress((pr) => ({ ...pr, coins: pr.coins + crate.value }));
                showBanner('جعبه سکه طلایی دریافت شد!', `+${crate.value} سکه به حساب شما اضافه شد`, 'crit', 2000);
              }
              return { ...crate, collected: true };
            }
            return crate;
          });
          return pickedUp ? { ...prevArena, crates: nextCrates } : prevArena;
        });

        return [p1, prev[1]];
      });

      soundEngine.playTrackMove();
    },
    [appState, isShotInFlight, currentTurn, arena, showBanner]
  );

  // Update active tank's barrel angle & power when dragging on the 3D scene
  const handleAimChange = useCallback(
    (barrelAngleDeg: number, powerPct: number) => {
      if (appState !== 'playing' || isShotInFlight || currentTurn !== 1) return;
      setTanks((prev) => {
        const p1 = { ...prev[0] };
        p1.barrelAngleDeg = Math.max(5, Math.min(75, barrelAngleDeg));
        p1.powerPct = Math.max(20, Math.min(100, powerPct));
        return [p1, prev[1]];
      });
    },
    [appState, isShotInFlight, currentTurn]
  );

  // Switch active shell during battle
  const handleSelectShellInBattle = useCallback(
    (shell: ShellSpec) => {
      if (appState !== 'playing' || isShotInFlight || currentTurn !== 1) return;
      soundEngine.playTurretServo(85);
      setProgress((prev) => ({ ...prev, selectedShellId: shell.id }));
      setTanks((prev) => [{ ...prev[0], shell }, prev[1]]);
    },
    [appState, isShotInFlight, currentTurn]
  );

  // Fire Tank Cannon
  const handleFire = useCallback(() => {
    if (appState !== 'playing' || isShotInFlight || currentTurn !== 1) return;

    const p1 = tanks[0];
    const p2 = tanks[1];
    const yawRad = Math.atan2(p2.z - p1.z, Math.abs(p2.x - p1.x));

    shotCounterRef.current += 1;
    setIsShotInFlight(true);
    setLastImpactBanner(null);
    setShotTrigger({
      shotId: shotCounterRef.current,
      shooterId: 1,
      barrelAngleDeg: p1.barrelAngleDeg,
      powerPct: p1.powerPct,
      turretYawRad: yawRad,
    });
  }, [appState, isShotInFlight, currentTurn, tanks]);

  // Resolve Shell Impact & Advance Turn or Complete Stage
  const handleShotResolved = useCallback(
    (result: HitDetectionResult, landingX: number) => {
      const shooterIdx = currentTurn - 1;
      const nextTanks: [TankCombatState, TankCombatState] = [
        { ...tanks[0] },
        { ...tanks[1] },
      ];
      nextTanks[shooterIdx].shotsFired += 1;
      nextTanks[shooterIdx].lastLandingX = landingX;

      let destroyedTankId: 1 | 2 | null = null;

      if (result.hitType === 'crate' && result.crateId) {
        setArena((prevArena) => {
          const hitCrate = prevArena.crates.find((c) => c.id === result.crateId);
          if (hitCrate && !hitCrate.collected) {
            if (hitCrate.kind === 'heal') {
              const healAmt = Math.round(nextTanks[shooterIdx].maxHp * 0.25);
              nextTanks[shooterIdx].hp = Math.min(
                nextTanks[shooterIdx].maxHp,
                nextTanks[shooterIdx].hp + healAmt
              );
              showBanner(
                'اصابت به جعبه کمک‌های اولیه!',
                `+${healAmt} جان برای ${nextTanks[shooterIdx].name}`,
                'hit',
                2200
              );
            } else if (shooterIdx === 0) {
              setProgress((pr) => ({ ...pr, coins: pr.coins + hitCrate.value }));
              showBanner(
                'انفجار جعبه سکه طلایی!',
                `+${hitCrate.value} سکه دریافت شد!`,
                'crit',
                2200
              );
            }
          }
          return {
            ...prevArena,
            crates: prevArena.crates.map((c) =>
              c.id === result.crateId ? { ...c, collected: true } : c
            ),
          };
        });
      } else if (result.hitType === 'tank' && result.targetTankId) {
        const targetIdx = result.targetTankId - 1;
        const dmg = result.damage ?? 28;
        nextTanks[targetIdx].hp = Math.max(0, nextTanks[targetIdx].hp - dmg);

        if (result.targetTankId !== currentTurn) {
          nextTanks[shooterIdx].hitsLanded += 1;
          if (result.hitZone === 'turret') {
            nextTanks[shooterIdx].critHits += 1;
          }
        }

        if (result.hitZone === 'tracks') {
          nextTanks[targetIdx].tracksDamaged = true;
        }

        const zoneTitle =
          result.hitZone === 'turret'
            ? '💥 اصابت بحرانی به برجک تانک!'
            : result.hitZone === 'hull'
              ? '🎯 اصابت مستقیم به زره بدنه'
              : '⚙️ اصابت به شنی و چرخ‌های تانک';

        showBanner(
          zoneTitle,
          `-${dmg} جان از ${nextTanks[targetIdx].name}${
            result.hitZone === 'tracks' ? ' · کاهش ۵۰٪ حرکت در نوبت بعد' : ''
          }`,
          result.hitZone === 'turret' ? 'crit' : 'hit',
          2500
        );

        window.setTimeout(() => {
          setTrailingHp([nextTanks[0].hp, nextTanks[1].hp]);
        }, 420);

        if (nextTanks[targetIdx].hp <= 0) {
          destroyedTankId = result.targetTankId;
        }
      } else if (result.hitType === 'obstacle' && result.obstacleId) {
        const dmg = result.damage ?? 45;
        setArena((prevArena) => {
          const updatedObs = prevArena.obstacles.map((obs) => {
            if (obs.id !== result.obstacleId) return obs;
            const nextHp = Math.max(0, obs.hp - dmg);
            return { ...obs, hp: nextHp, destroyed: nextHp <= 0 };
          });
          const hitObs = updatedObs.find((o) => o.id === result.obstacleId);
          showBanner(
            hitObs?.destroyed ? 'انهدام کامل مانع میدان!' : 'برخورد گلوله با مانع زرهی',
            hitObs?.destroyed ? 'مسیر آتش اکنون باز شد!' : `استحکام باقی‌مانده مانع: ${hitObs?.hp}`,
            'miss',
            2000
          );
          return { ...prevArena, obstacles: updatedObs };
        });
      } else {
        const targetIdx = currentTurn === 1 ? 1 : 0;
        const missDist = Math.abs(landingX - nextTanks[targetIdx].x);
        showBanner(
          'اصابت به زمین و ایجاد گودال انفجار',
          `فاصله تا تانک هدف: ${missDist.toFixed(1)} متر`,
          'miss',
          1800
        );
      }

      // Record physical 3D ground crater in arena state & settle tanks onto deformed terrain
      if (result.craterRadius && result.craterDepth) {
        const newCrater = {
          id: `crater-${Date.now()}-${shotCounterRef.current}`,
          x: result.hitPoint.x,
          z: result.hitPoint.z,
          radius: result.craterRadius,
          depth: result.craterDepth,
        };
        const arenaWithCrater: BattlefieldConfig = {
          ...arena,
          craters: [...arena.craters, newCrater],
        };
        for (let i = 0; i < 2; i++) {
          nextTanks[i].y = terrainHeightAt(nextTanks[i].x, arenaWithCrater, nextTanks[i].z);
          nextTanks[i].slopeAngle = terrainSlopeAt(nextTanks[i].x, arenaWithCrater, nextTanks[i].z);
        }
        setArena((prevArena) => ({
          ...prevArena,
          craters: [...prevArena.craters, newCrater],
        }));
      }

      // Check if either tank was destroyed
      if (destroyedTankId !== null) {
        setTanks(nextTanks);
        const isVictory = destroyedTankId === 2;
        const baseReward = isVictory ? 95 + progress.stageNumber * 40 : 25;
        const critBonus = isVictory ? nextTanks[0].critHits * 20 : 0;
        const totalCoinsEarned = baseReward + critBonus;

        window.setTimeout(() => {
          soundEngine.playMatchEnd(isVictory);
          setProgress((prev) => ({
            ...prev,
            coins: prev.coins + totalCoinsEarned,
            stageNumber: isVictory ? prev.stageNumber + 1 : prev.stageNumber,
          }));
          setMatchOutcome({
            victory: isVictory,
            stageCleared: progress.stageNumber,
            coinsEarned: totalCoinsEarned,
            enemyTankName: nextTanks[1].model.name,
            critHits: nextTanks[0].critHits,
          });
          setIsShotInFlight(false);
          setAppState('gameover');
        }, 950);
        return;
      }

      // Prepare Next Turn & Replenish Fuel (50% if tracks were damaged!)
      const nextTurn: 1 | 2 = currentTurn === 1 ? 2 : 1;
      const nextIdx = nextTurn - 1;
      const maxFuel = nextTanks[nextIdx].model.moveFuelMax;
      nextTanks[nextIdx].moveFuel = nextTanks[nextIdx].tracksDamaged ? maxFuel * 0.5 : maxFuel;
      nextTanks[nextIdx].maxMoveFuel = maxFuel;
      // Clear track penalty after applying it for one turn
      if (currentTurn === nextTurn) {
        nextTanks[nextIdx].tracksDamaged = false;
      } else {
        nextTanks[shooterIdx].tracksDamaged = false;
      }

      const nextTurnNumber = nextTurn === 1 ? turnCount + 1 : turnCount;
      const nextWind = generateTurnWind(arena.biome, arena.seed + nextTurnNumber * 137 + nextTurn * 41);

      setTanks(nextTanks);
      setCurrentTurn(nextTurn);
      setTurnCount(nextTurnNumber);
      setWindSpeed(nextWind);
      setIsShotInFlight(false);
    },
    [currentTurn, tanks, progress.stageNumber, turnCount, arena, showBanner]
  );

  // Execute Enemy AI Tank Turn (Movement + Aiming + Firing)
  useEffect(() => {
    if (appState !== 'playing' || currentTurn !== 2 || isShotInFlight) {
      return;
    }

    const playerTank = tanks[0];
    const aiTank = tanks[1];
    const decision = computeAITankTurn(
      aiTank,
      playerTank,
      windSpeed,
      arena,
      progress.stageNumber,
      arena.seed + turnCount * 73
    );

    // Step 1: AI drives slightly forward/backward and sideways to dodge
    const moveTimer = window.setTimeout(() => {
      soundEngine.playTrackMove();
      setTanks((prev) => {
        const halfDist = arena.distance * 0.5;
        const nextX = Math.max(6.0, Math.min(halfDist + 8.5, prev[1].x + decision.moveDeltaX));
        const nextZ = Math.max(-4.5, Math.min(4.5, prev[1].z + decision.moveDeltaZ));
        const nextY = terrainHeightAt(nextX, arena, nextZ);
        return [
          prev[0],
          {
            ...prev[1],
            x: nextX,
            y: nextY,
            z: nextZ,
            slopeAngle: terrainSlopeAt(nextX, arena, nextZ),
            barrelAngleDeg: decision.barrelAngleDeg,
            powerPct: decision.powerPct,
            turretYawRad: decision.turretYawRad,
          },
        ];
      });
    }, 450);

    // Step 2: AI fires cannon
    aiTimerRef.current = window.setTimeout(() => {
      shotCounterRef.current += 1;
      setIsShotInFlight(true);
      setShotTrigger({
        shotId: shotCounterRef.current,
        shooterId: 2,
        barrelAngleDeg: decision.barrelAngleDeg,
        powerPct: decision.powerPct,
        turretYawRad: decision.turretYawRad,
      });
    }, 1050);

    return () => {
      window.clearTimeout(moveTimer);
      if (aiTimerRef.current) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [appState, currentTurn, isShotInFlight, windSpeed, arena, progress.stageNumber, turnCount]);

  const isAITurn = currentTurn === 2;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0c1017] select-none">
      {/* 100% Full-Viewport 3D Tank Battlefield & Garage Showcase Canvas */}
      <ArenaCanvas
        appState={appState}
        arena={arena}
        tanks={tanks}
        currentTurn={currentTurn}
        windSpeed={windSpeed}
        cameraPreset={cameraPreset}
        isAITurn={isAITurn}
        shotTrigger={shotTrigger}
        onAimChange={handleAimChange}
        onShotResolved={handleShotResolved}
      />

      {/* VIEW 1: 3D TANK GARAGE (3 Free Unlocked Tanks + 7 Coin-Unlockable Tanks) */}
      {appState === 'garage' && (
        <div
          className="fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-6 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(8,11,18,0.82) 0%, rgba(8,11,18,0.18) 38%, rgba(8,11,18,0.92) 100%)',
          }}
        >
          {/* Top Header: Game Title, Stage Badge, Coin Balance & Shell Shop Button */}
          <div className="w-full max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-2xl shadow-lg">
                🛡️
              </div>
              <div>
                <h1 className="font-display text-xl sm:text-3xl font-extrabold text-white stroke-text">
                  جنگ تانک‌ها
                </h1>
                <p className="text-[11px] sm:text-xs font-bold text-amber-400">
                  مرحله فعلی: {progress.stageNumber} · {arena.biomeTitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-xl border border-amber-500/40 bg-[#0c1017]/90 px-3.5 py-2 flex items-center gap-1.5 font-mono-num text-sm sm:text-base font-extrabold text-amber-400 shadow">
                <span>🪙</span>
                <span>{progress.coins}</span>
                <span className="text-xs font-normal text-slate-300 mr-1" dir="rtl">
                  سکه
                </span>
              </div>

              <button
                type="button"
                onClick={() => setAppState('shop')}
                className="rounded-xl border border-sky-400/50 bg-sky-500/20 px-3.5 py-2 text-xs sm:text-sm font-extrabold text-sky-300 hover:bg-sky-500/30 transition-colors whitespace-nowrap"
              >
                🚀 فروشگاه گلوله تانک
              </button>
            </div>
          </div>

          {/* Bottom Garage Panel: 10 Tank Selector Carousel + Go To Battle Button */}
          <div className="w-full max-w-6xl mx-auto pointer-events-auto space-y-3">
            {/* Selected Tank Specs Banner */}
            <div className="rounded-2xl border border-white/15 bg-[#0c1017]/90 p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xl">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base sm:text-xl font-extrabold text-white">
                    {selectedTank.name}
                  </span>
                  <span className="rounded-md bg-amber-500/20 border border-amber-400/40 px-2 py-0.5 text-[10px] font-mono-num font-bold text-amber-300">
                    {selectedTank.codeName}
                  </span>
                  {selectedTank.barrelCount === 2 && (
                    <span className="rounded-md bg-rose-500/20 border border-rose-400/40 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                      دو لول هم‌زمان
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300 mt-1">{selectedTank.description}</p>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                <div className="text-xs text-slate-300 space-y-0.5 font-mono-num">
                  <div>قدرت توپ: <strong className="text-amber-400">{Math.round(selectedTank.damageMultiplier * 100)}%</strong></div>
                  <div>زره بدنه: <strong className="text-emerald-400">{Math.round(selectedTank.armorMultiplier * 100)}%</strong></div>
                </div>

                <button
                  type="button"
                  data-start="true"
                  onClick={() => startBattleStage(progress.stageNumber)}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3.5 text-sm sm:text-base font-extrabold text-slate-950 shadow-xl hover:from-amber-400 hover:to-orange-400 active:scale-[0.99] transition-all whitespace-nowrap"
                >
                  ⚔️ برو به بازی (مرحله {progress.stageNumber})
                </button>
              </div>
            </div>

            {/* 10 Tank Models Horizontal / Grid Selector */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 max-h-[34vh] overflow-y-auto pr-1">
              {TANK_CATALOG.map((tank) => {
                const isUnlocked = progress.unlockedTankIds.includes(tank.id);
                const isSelected = selectedTank.id === tank.id;
                const canAfford = progress.coins >= tank.price;

                return (
                  <button
                    key={tank.id}
                    type="button"
                    onClick={() => handleSelectOrBuyTank(tank)}
                    className={`rounded-xl border p-2.5 text-right transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                        : isUnlocked
                          ? 'border-emerald-500/40 bg-[#121824]/90 hover:border-emerald-400'
                          : canAfford
                            ? 'border-sky-400/40 bg-[#121824]/90 hover:border-sky-400'
                            : 'border-white/10 bg-[#0c1017]/80 opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-extrabold text-white truncate">
                        {tank.index + 1}. {tank.name}
                      </span>
                      <span
                        className="w-3 h-3 rounded-full shrink-0 border border-white/30"
                        style={{ backgroundColor: tank.hullColor }}
                      />
                    </div>

                    <div className="my-1.5 flex items-center justify-between text-[10px] text-slate-300 font-mono-num">
                      <span>DMG {Math.round(tank.damageMultiplier * 100)}%</span>
                      <span>{tank.barrelCount === 2 ? '2x لوله' : '1x لوله'}</span>
                    </div>

                    <div className="pt-1 border-t border-white/10 flex items-center justify-between">
                      {isSelected ? (
                        <span className="text-[11px] font-extrabold text-amber-400">
                          ✓ انتخاب‌شده
                        </span>
                      ) : isUnlocked ? (
                        <span className="text-[11px] font-bold text-emerald-400">
                          باز (انتخاب)
                        </span>
                      ) : (
                        <span
                          className={`text-[11px] font-extrabold font-mono-num ${
                            canAfford ? 'text-sky-300' : 'text-rose-400'
                          }`}
                        >
                          🔒 خرید: {tank.price} 🪙
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: TANK SHELL SHOP (فروشگاه گلوله تانک - Unlimited Ammo Once Purchased) */}
      {appState === 'shop' && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-3 sm:p-6 pointer-events-auto"
          style={{ backgroundColor: 'rgba(8, 11, 16, 0.88)' }}
        >
          <div className="w-full max-w-3xl rounded-2xl border border-sky-500/40 bg-[#121824] p-4 sm:p-6 text-white shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h2 className="text-lg sm:text-2xl font-extrabold text-sky-400">
                  🚀 فروشگاه گلوله تانک (مهمات نامحدود ∞)
                </h2>
                <p className="text-xs text-slate-300 mt-0.5">
                  هر مدل گلوله را که یک‌بار بخرید، برای همیشه با تعداد نامحدود روی تانک شما قابل استفاده است.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-xl bg-[#0c1017] border border-amber-500/40 px-3 py-1.5 font-mono-num text-sm font-extrabold text-amber-400">
                  🪙 {progress.coins}
                </div>
                <button
                  type="button"
                  onClick={() => setAppState('garage')}
                  className="rounded-xl border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-white/20"
                >
                  بازگشت به گاراژ
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SHELL_CATALOG.map((shell) => {
                const isUnlocked = progress.unlockedShellIds.includes(shell.id);
                const isSelected = selectedShell.id === shell.id;
                const tankRequirementMet = selectedTank.index >= shell.minTankIndex;
                const canAfford = progress.coins >= shell.price;

                return (
                  <div
                    key={shell.id}
                    className={`rounded-xl border p-4 flex flex-col justify-between gap-3 ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500/15'
                        : isUnlocked
                          ? 'border-emerald-500/40 bg-[#0c1017]'
                          : 'border-white/10 bg-[#0c1017]/90'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm sm:text-base font-extrabold text-white">
                          {shell.name}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded text-[11px] font-mono-num font-bold text-slate-950"
                          style={{ backgroundColor: shell.badgeColor }}
                        >
                          قدرت {Math.round(shell.damageMultiplier * 100)}%
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1.5">{shell.description}</p>
                      {!isUnlocked && shell.minTankIndex > 0 && (
                        <div className="mt-1.5 text-[11px] text-amber-300">
                          نیازمند حداقل تانک شماره {shell.minTankIndex + 1} ({TANK_CATALOG[shell.minTankIndex].name})
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={!isUnlocked && (!tankRequirementMet || !canAfford)}
                      onClick={() => handleSelectOrBuyShell(shell)}
                      className={`w-full rounded-xl py-2.5 px-4 text-xs sm:text-sm font-extrabold transition-all ${
                        isSelected
                          ? 'bg-amber-500 text-slate-950'
                          : isUnlocked
                            ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                            : tankRequirementMet && canAfford
                              ? 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                              : 'bg-white/10 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      {isSelected
                        ? '✓ گلوله فعال روی تانک (تعداد نامحدود ∞)'
                        : isUnlocked
                          ? 'انتخاب این گلوله (تعداد نامحدود ∞)'
                          : !tankRequirementMet
                            ? `نیازمند تانک رده ${shell.minTankIndex + 1}+`
                            : `خرید دائمی گلوله (${shell.price} 🪙)`}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => startBattleStage(progress.stageNumber)}
                className="rounded-xl bg-amber-500 px-6 py-3 text-sm font-extrabold text-slate-950 hover:bg-amber-400 transition-colors"
              >
                ⚔️ برو به میدان نبرد (مرحله {progress.stageNumber})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: ACTIVE BATTLE HUD (Clean, Guide-Free, 5 Camera Presets, 4-Way Movement D-Pad) */}
      {(appState === 'playing' || appState === 'paused' || appState === 'gameover') && (
        <GameHud
          tanks={tanks}
          trailingHp={trailingHp}
          currentTurn={currentTurn}
          stageNumber={progress.stageNumber}
          biomeTitle={arena.biomeTitle}
          coins={progress.coins}
          windSpeed={windSpeed}
          unlockedShellIds={progress.unlockedShellIds}
          selectedShellId={selectedShell.id}
          isAITurn={isAITurn}
          isShotInFlight={isShotInFlight}
          lastImpactBanner={lastImpactBanner}
          cameraPreset={cameraPreset}
          isMuted={isMuted}
          onMoveTank={handleMoveTank}
          onSelectShell={handleSelectShellInBattle}
          onFire={handleFire}
          onCycleCamera={() =>
            setCameraPreset((prev) => {
              const idx = CAMERA_PRESET_ORDER.indexOf(prev);
              return CAMERA_PRESET_ORDER[(idx + 1) % CAMERA_PRESET_ORDER.length];
            })
          }
          onToggleMute={() => {
            const m = soundEngine.toggleMute();
            setIsMuted(m);
          }}
          onPause={() => setAppState('paused')}
        />
      )}

      {/* PAUSE MODAL */}
      {appState === 'paused' && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(8, 11, 16, 0.86)' }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#121824] p-6 text-center shadow-2xl space-y-4">
            <h2 className="text-2xl font-extrabold text-amber-400">توقف بازی · مرحله {progress.stageNumber}</h2>
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setAppState('playing')}
                className="w-full rounded-xl bg-amber-500 py-3 text-sm font-extrabold text-slate-950 hover:bg-amber-400"
              >
                ادامه نبرد
              </button>
              <button
                type="button"
                onClick={() => setAppState('shop')}
                className="w-full rounded-xl border border-sky-400/40 bg-sky-500/15 py-2.5 text-sm font-bold text-sky-300 hover:bg-sky-500/25"
              >
                فروشگاه گلوله تانک
              </button>
              <button
                type="button"
                onClick={() => setAppState('garage')}
                className="w-full rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-bold text-white hover:bg-white/10"
              >
                بازگشت به گاراژ و انتخاب تانک
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STAGE VICTORY / DEFEAT MODAL */}
      {appState === 'gameover' && matchOutcome && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(8, 11, 16, 0.90)' }}
        >
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#121824] p-6 text-center shadow-2xl space-y-5">
            <div>
              <h2
                className={`text-2xl sm:text-3xl font-extrabold ${
                  matchOutcome.victory ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {matchOutcome.victory
                  ? `پیروزی! انهدام کامل ${matchOutcome.enemyTankName}`
                  : 'تانک شما منهدم شد!'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 mt-1">
                {matchOutcome.victory
                  ? `مرحله ${matchOutcome.stageCleared} با موفقیت فتح شد · آماده ورود به مرحله ${progress.stageNumber} با نقشه جدید و دشمن قوی‌تر`
                  : `تلاش مجدد در مرحله ${progress.stageNumber} یا ارتقای تانک و گلوله در گاراژ`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono-num">
              <div className="rounded-xl bg-[#0c1017] p-3 border border-amber-500/30">
                <div className="text-slate-400">پاداش این نبرد</div>
                <div className="text-lg font-extrabold text-amber-400 mt-0.5">
                  +{matchOutcome.coinsEarned} 🪙
                </div>
              </div>
              <div className="rounded-xl bg-[#0c1017] p-3 border border-white/10">
                <div className="text-slate-400">مجموع سکه‌های شما</div>
                <div className="text-lg font-extrabold text-emerald-400 mt-0.5">
                  {progress.coins} 🪙
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                data-start="true"
                onClick={() => startBattleStage(progress.stageNumber)}
                className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-3.5 text-base font-extrabold text-slate-950 shadow-lg hover:from-amber-400 hover:to-orange-400"
              >
                {matchOutcome.victory
                  ? `⚔️ ورود به مرحله ${progress.stageNumber} (نقشه جدید و تانک دشمن قوی‌تر)`
                  : `🔄 تلاش مجدد در مرحله ${progress.stageNumber}`}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAppState('garage')}
                  className="rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-white hover:bg-white/10"
                >
                  🛡️ گاراژ خرید تانک
                </button>
                <button
                  type="button"
                  onClick={() => setAppState('shop')}
                  className="rounded-xl border border-sky-400/40 bg-sky-500/15 py-2.5 text-xs font-bold text-sky-300 hover:bg-sky-500/25"
                >
                  🚀 فروشگاه گلوله تانک
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
