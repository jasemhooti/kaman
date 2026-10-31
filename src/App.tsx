/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeAIShot,
  generateArenaConfig,
  generateTurnWind,
  terrainHeightAt,
  type AIDifficulty,
  type ArenaConfig,
  type ArcherState,
  type GameMode,
  type HitDetectionResult,
  type WeatherType,
} from './game/physics';
import { ArenaCanvas, type ActiveShotTrigger, type CameraViewMode } from './game/ArenaCanvas';
import { GameHud } from './components/GameHud';
import { AndroidApkModal } from './components/AndroidApkModal';
import { soundEngine } from './game/sound';

type AppState = 'title' | 'playing' | 'paused' | 'gameover';

interface MatchSnapshot {
  winnerId: 1 | 2;
  winnerName: string;
  isPlayerVictory: boolean;
  turnsTaken: number;
  p1Accuracy: number;
  p2Accuracy: number;
  p1Headshots: number;
  p2Headshots: number;
  distance: number;
}

function createInitialArchers(arena: ArenaConfig, mode: GameMode): [ArcherState, ArcherState] {
  const halfDist = arena.distance * 0.5;
  const x1 = -halfDist;
  const x2 = halfDist;
  const y1 = terrainHeightAt(x1, arena);
  const y2 = terrainHeightAt(x2, arena);

  return [
    {
      id: 1,
      name: 'کماندار ۱ (آبی)',
      x: x1,
      y: y1,
      facing: 1,
      hp: 100,
      maxHp: 100,
      angleDeg: 42,
      powerPct: 72,
      shotsFired: 0,
      hitsLanded: 0,
      headshots: 0,
      lastLandingX: null,
    },
    {
      id: 2,
      name: mode === '1p' ? 'کماندار هوش مصنوعی' : 'کماندار ۲ (سرخ)',
      x: x2,
      y: y2,
      facing: -1,
      hp: 100,
      maxHp: 100,
      angleDeg: 44,
      powerPct: 72,
      shotsFired: 0,
      hitsLanded: 0,
      headshots: 0,
      lastLandingX: null,
    },
  ];
}

export default function App() {
  const initialAutostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [appState, setAppState] = useState<AppState>(initialAutostart ? 'playing' : 'title');
  const [gameMode, setGameMode] = useState<GameMode>('1p');
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium');
  const [weather, setWeather] = useState<WeatherType>('clear');

  const [arena, setArena] = useState<ArenaConfig>(() => generateArenaConfig(104729));
  const [archers, setArchers] = useState<[ArcherState, ArcherState]>(() =>
    createInitialArchers(generateArenaConfig(104729), '1p')
  );
  const [trailingHp, setTrailingHp] = useState<[number, number]>([100, 100]);

  const [currentTurn, setCurrentTurn] = useState<1 | 2>(1);
  const [turnCount, setTurnCount] = useState<number>(1);
  const [windSpeed, setWindSpeed] = useState<number>(() => generateTurnWind('clear', 2026));
  const [isShotInFlight, setIsShotInFlight] = useState<boolean>(false);
  const [shotTrigger, setShotTrigger] = useState<ActiveShotTrigger | null>(null);
  const [aiStatusText, setAiStatusText] = useState<string>('در حال محاسبه زاویه و سرعت باد...');

  const [lastImpactBanner, setLastImpactBanner] = useState<{
    text: string;
    subtext: string;
    tone: 'crit' | 'hit' | 'miss';
  } | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraViewMode>('auto');
  const [cinematicFollow, setCinematicFollow] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [apkModalOpen, setApkModalOpen] = useState<boolean>(false);
  const [matchSnapshot, setMatchSnapshot] = useState<MatchSnapshot | null>(null);

  const shotCounterRef = useRef<number>(1);
  const aiTimerRef = useRef<number | null>(null);
  const bannerTimerRef = useRef<number | null>(null);

  // Sync document.body.dataset.state for accessibility & browser verification
  useEffect(() => {
    document.body.dataset.state = appState;
  }, [appState]);

  const showBanner = useCallback(
    (text: string, subtext: string, tone: 'crit' | 'hit' | 'miss', durationMs = 2600) => {
      if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current);
      setLastImpactBanner({ text, subtext, tone });
      bannerTimerRef.current = window.setTimeout(() => {
        setLastImpactBanner(null);
      }, durationMs);
    },
    []
  );

  // Start or Restart Match with Fresh Uneven Terrain & Destructible Obstacles
  const startMatch = useCallback(
    (overrideMode?: GameMode, overrideDiff?: AIDifficulty, overrideWeather?: WeatherType, customSeed?: number) => {
      if (aiTimerRef.current) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
      const mode = overrideMode ?? gameMode;
      const diff = overrideDiff ?? aiDifficulty;
      const wth = overrideWeather ?? weather;
      const seed = customSeed ?? Date.now();

      const nextArena = generateArenaConfig(seed);
      const nextArchers = createInitialArchers(nextArena, mode);
      const nextWind = generateTurnWind(wth, seed + 17);

      setGameMode(mode);
      setAiDifficulty(diff);
      setWeather(wth);
      setArena(nextArena);
      setArchers(nextArchers);
      setTrailingHp([100, 100]);
      setCurrentTurn(1);
      setTurnCount(1);
      setWindSpeed(nextWind);
      setIsShotInFlight(false);
      setShotTrigger(null);
      setMatchSnapshot(null);
      setAppState('playing');

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      showBanner(
        mode === '1p' ? 'نبرد آغاز شد · نوبت کماندار ۱' : 'نبرد دونفره آغاز شد · نوبت کماندار ۱',
        `فاصله: ${Math.round(nextArena.distance)} متر · باد: ${Math.abs(nextWind).toFixed(1)} m/s`,
        'hit',
        2200
      );
    },
    [gameMode, aiDifficulty, weather, showBanner]
  );

  // Update active archer's aim angle & power
  const handleAimChange = useCallback(
    (angleDeg: number, powerPct: number) => {
      if (appState !== 'playing' || isShotInFlight) return;
      setArchers((prev) => {
        const next: [ArcherState, ArcherState] = [{ ...prev[0] }, { ...prev[1] }];
        const active = next[currentTurn - 1];
        active.angleDeg = Math.max(5, Math.min(85, angleDeg));
        active.powerPct = Math.max(15, Math.min(100, powerPct));
        return next;
      });
    },
    [appState, isShotInFlight, currentTurn]
  );

  // Fire arrow for active archer
  const handleFire = useCallback(() => {
    if (appState !== 'playing' || isShotInFlight) return;
    if (gameMode === '1p' && currentTurn === 2) return;

    const active = archers[currentTurn - 1];
    shotCounterRef.current += 1;
    setIsShotInFlight(true);
    setLastImpactBanner(null);
    setShotTrigger({
      shotId: shotCounterRef.current,
      shooterId: currentTurn,
      angleDeg: active.angleDeg,
      powerPct: active.powerPct,
    });
  }, [appState, isShotInFlight, gameMode, currentTurn, archers]);

  // Handle arrow impact resolution & turn transition
  const handleShotResolved = useCallback(
    (result: HitDetectionResult, landingX: number) => {
      const shooterIdx = currentTurn - 1;
      const nextArchers: [ArcherState, ArcherState] = [
        { ...archers[0] },
        { ...archers[1] },
      ];
      nextArchers[shooterIdx].shotsFired += 1;
      nextArchers[shooterIdx].lastLandingX = landingX;

      let fatalKillOnArcherId: 1 | 2 | null = null;

      if (result.hitType === 'archer' && result.targetArcherId) {
        const targetIdx = result.targetArcherId - 1;
        const dmg = result.damage ?? 30;
        nextArchers[targetIdx].hp = Math.max(0, nextArchers[targetIdx].hp - dmg);

        if (result.targetArcherId !== currentTurn) {
          nextArchers[shooterIdx].hitsLanded += 1;
          if (result.hitZone === 'head') {
            nextArchers[shooterIdx].headshots += 1;
          }
        }

        const zoneLabel =
          result.hitZone === 'head'
            ? 'هدشات بحرانی! (HEADSHOT CRITICAL)'
            : result.hitZone === 'body'
              ? 'اصابت به سینه و بالاتنه (Body Hit)'
              : 'اصابت به دست و پا (Limb Hit)';

        showBanner(
          zoneLabel,
          `آسیب وارده: -${dmg}% سلامتی به ${nextArchers[targetIdx].name}`,
          result.hitZone === 'head' ? 'crit' : 'hit',
          2800
        );

        // Update trailing damage ghost bar after 450ms
        window.setTimeout(() => {
          setTrailingHp([nextArchers[0].hp, nextArchers[1].hp]);
        }, 450);

        if (nextArchers[targetIdx].hp <= 0) {
          fatalKillOnArcherId = result.targetArcherId;
        }
      } else if (result.hitType === 'obstacle' && result.obstacleId) {
        const dmg = result.damage ?? 30;
        setArena((prevArena) => {
          const updatedObs = prevArena.obstacles.map((obs) => {
            if (obs.id !== result.obstacleId) return obs;
            const nextHp = Math.max(0, obs.hp - dmg);
            return {
              ...obs,
              hp: nextHp,
              destroyed: nextHp <= 0,
            };
          });
          const hitObs = updatedObs.find((o) => o.id === result.obstacleId);
          const obsName =
            hitObs?.kind === 'barrel'
              ? 'بشکه چوبی'
              : hitObs?.kind === 'wall'
                ? 'دیوار قلعه'
                : 'صخره سنگی';
          showBanner(
            hitObs?.destroyed ? `تخریب کامل ${obsName}!` : `برخورد تیر با ${obsName}`,
            hitObs?.destroyed
              ? 'مسیر پرتاب اکنون باز شد!'
              : `استحکام باقی‌مانده مانع: ${hitObs?.hp} HP (برای عبور، شلیک قوسی Arch Shot بزنید)`,
            'miss',
            2500
          );
          return { ...prevArena, obstacles: updatedObs };
        });
      } else {
        const targetIdx = currentTurn === 1 ? 1 : 0;
        const missDist = Math.abs(landingX - nextArchers[targetIdx].x);
        showBanner(
          'برخورد تیر به زمین',
          `فاصله تا هدف: ${missDist.toFixed(1)} متر`,
          'miss',
          2000
        );
      }

      setArchers(nextArchers);

      // Check Victory / Game Over condition
      if (fatalKillOnArcherId !== null) {
        const winnerId: 1 | 2 = fatalKillOnArcherId === 1 ? 2 : 1;
        const winner = nextArchers[winnerId - 1];
        const p1Acc =
          nextArchers[0].shotsFired > 0
            ? Math.round((nextArchers[0].hitsLanded / nextArchers[0].shotsFired) * 100)
            : 0;
        const p2Acc =
          nextArchers[1].shotsFired > 0
            ? Math.round((nextArchers[1].hitsLanded / nextArchers[1].shotsFired) * 100)
            : 0;

        const snapshot: MatchSnapshot = {
          winnerId,
          winnerName: winner.name,
          isPlayerVictory: gameMode === '2p' ? true : winnerId === 1,
          turnsTaken: turnCount,
          p1Accuracy: p1Acc,
          p2Accuracy: p2Acc,
          p1Headshots: nextArchers[0].headshots,
          p2Headshots: nextArchers[1].headshots,
          distance: Math.round(arena.distance),
        };

        // Wait 650ms so player sees the Ragdoll physics KO topple before Game Over modal
        window.setTimeout(() => {
          soundEngine.playMatchEnd(snapshot.isPlayerVictory);
          setMatchSnapshot(snapshot);
          setIsShotInFlight(false);
          setAppState('gameover');
        }, 650);
        return;
      }

      // Advance Turn & Generate Dynamic Wind for Next Turn
      const nextTurn: 1 | 2 = currentTurn === 1 ? 2 : 1;
      const nextTurnNumber = nextTurn === 1 ? turnCount + 1 : turnCount;
      const nextWind = generateTurnWind(weather, arena.seed + nextTurnNumber * 131 + nextTurn * 37);

      setCurrentTurn(nextTurn);
      setTurnCount(nextTurnNumber);
      setWindSpeed(nextWind);
      setIsShotInFlight(false);
    },
    [currentTurn, archers, arena.distance, arena.seed, gameMode, turnCount, weather, showBanner]
  );

  // Trigger AI Shot when it is AI's Turn in 1P Mode
  useEffect(() => {
    if (appState !== 'playing' || gameMode !== '1p' || currentTurn !== 2 || isShotInFlight) {
      return;
    }

    const aiArcher = archers[1];
    const playerArcher = archers[0];
    const decision = computeAIShot(
      aiArcher,
      playerArcher,
      windSpeed,
      arena,
      aiDifficulty,
      arena.seed + turnCount * 53
    );

    setAiStatusText(decision.reasoningTag);

    // Telegraph AI aiming pose before releasing arrow
    const aimStepTimer = window.setTimeout(() => {
      soundEngine.playBowDrawCreak(decision.powerPct);
      setArchers((prev) => [
        prev[0],
        {
          ...prev[1],
          angleDeg: decision.angleDeg,
          powerPct: decision.powerPct,
        },
      ]);
    }, 420);

    aiTimerRef.current = window.setTimeout(() => {
      shotCounterRef.current += 1;
      setIsShotInFlight(true);
      setShotTrigger({
        shotId: shotCounterRef.current,
        shooterId: 2,
        angleDeg: decision.angleDeg,
        powerPct: decision.powerPct,
      });
    }, 950);

    return () => {
      window.clearTimeout(aimStepTimer);
      if (aiTimerRef.current) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [appState, gameMode, currentTurn, isShotInFlight, aiDifficulty, windSpeed, arena, turnCount]);

  // Global Keyboard Controls & Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (apkModalOpen) {
        if (e.key === 'Escape') setApkModalOpen(false);
        return;
      }

      if (appState === 'title') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startMatch();
        }
        return;
      }

      if (appState === 'gameover') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startMatch();
        }
        return;
      }

      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault();
        setAppState((prev) => (prev === 'paused' ? 'playing' : 'paused'));
        return;
      }

      if (appState !== 'playing') return;

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        const muted = soundEngine.toggleMute();
        setIsMuted(muted);
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setDockCollapsed((prev) => !prev);
        return;
      }

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setCameraMode((prev) =>
          prev === 'auto' ? 'overview' : prev === 'overview' ? 'focus' : 'auto'
        );
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        startMatch();
        return;
      }

      // Active turn aiming & firing keys
      const isAITurn = gameMode === '1p' && currentTurn === 2;
      if (isAITurn || isShotInFlight) return;

      const active = archers[currentTurn - 1];
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        const nextAng = Math.min(85, Math.round(active.angleDeg) + 1);
        soundEngine.playBowDrawCreak(active.powerPct);
        handleAimChange(nextAng, active.powerPct);
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        const nextAng = Math.max(5, Math.round(active.angleDeg) - 1);
        soundEngine.playBowDrawCreak(active.powerPct);
        handleAimChange(nextAng, active.powerPct);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        const nextPwr = Math.min(100, Math.round(active.powerPct) + 2);
        soundEngine.playBowDrawCreak(nextPwr);
        handleAimChange(active.angleDeg, nextPwr);
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        const nextPwr = Math.max(15, Math.round(active.powerPct) - 2);
        soundEngine.playBowDrawCreak(nextPwr);
        handleAimChange(active.angleDeg, nextPwr);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleFire();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    apkModalOpen,
    appState,
    gameMode,
    currentTurn,
    isShotInFlight,
    archers,
    startMatch,
    handleAimChange,
    handleFire,
  ]);

  const isAITurn = gameMode === '1p' && currentTurn === 2;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0c1017] select-none">
      {/* 100% Full-Bleed Three.js 3D Arena Viewport */}
      <ArenaCanvas
        appState={appState}
        arena={arena}
        archers={archers}
        currentTurn={currentTurn}
        windSpeed={windSpeed}
        weather={weather}
        cameraMode={cameraMode}
        cinematicFollow={cinematicFollow}
        isAITurn={isAITurn}
        shotTrigger={shotTrigger}
        onAimChange={handleAimChange}
        onDragFire={handleFire}
        onShotResolved={handleShotResolved}
      />

      {/* STAGE 1: TITLE SCREEN OVERLAY */}
      {appState === 'title' && (
        <div
          className="fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-10 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(8,11,18,0.75) 0%, rgba(8,11,18,0.35) 45%, rgba(8,11,18,0.85) 100%)',
          }}
        >
          {/* Portrait & Desktop Responsive Title Lockup & Configuration */}
          <div className="my-auto max-w-xl w-full mx-auto lg:mx-0 pointer-events-auto space-y-4 sm:space-y-5">
            {/* Custom Inline SVG Title Lockup Emblem */}
            <div className="flex items-center gap-3.5 sm:gap-4">
              <svg className="w-14 h-14 sm:w-20 sm:h-20 shrink-0" viewBox="0 0 120 120">
                <defs>
                  <linearGradient id="crestGold" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fde68a" />
                    <stop offset="50%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#b45309" />
                  </linearGradient>
                </defs>
                <polygon
                  points="60,6 108,28 96,92 60,114 24,92 12,28"
                  fill="#0f172a"
                  stroke="url(#crestGold)"
                  strokeWidth="4"
                />
                {/* Recurve Bow Arc */}
                <path
                  d="M 44 24 C 78 40, 78 80, 44 96"
                  fill="none"
                  stroke="url(#crestGold)"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <line x1="44" y1="24" x2="30" y2="60" stroke="#e2e8f0" strokeWidth="2" />
                <line x1="44" y1="96" x2="30" y2="60" stroke="#e2e8f0" strokeWidth="2" />
                {/* Crossed Arrow */}
                <line x1="26" y1="60" x2="94" y2="60" stroke="#f8fafc" strokeWidth="3.5" />
                <polygon points="98,60 84,52 87,60 84,68" fill="#ef4444" />
              </svg>

              <div>
                <h1 className="font-display text-2xl sm:text-5xl font-extrabold tracking-tight text-white stroke-text">
                  نبرد کمانداران
                </h1>
                <p className="font-display text-[11px] sm:text-sm font-semibold tracking-widest text-amber-400 mt-0.5">
                  KAMAN DUEL 3D · HD PORTRAIT & LANDSCAPE
                </p>
              </div>
            </div>

            {/* Mode & AI Difficulty Controls */}
            <div className="rounded-2xl border border-white/15 bg-[#0c1017]/90 p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 shadow-2xl">
              {/* Game Mode Selector */}
              <div>
                <span className="block text-xs font-bold text-slate-300 mb-1.5">
                  حالت بازی (Game Mode):
                </span>
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2 p-1 rounded-xl bg-[#070a0f] border border-white/10">
                  <button
                    type="button"
                    onClick={() => setGameMode('1p')}
                    className={`rounded-lg py-2 px-2 text-xs sm:text-sm font-bold transition-colors whitespace-nowrap ${
                      gameMode === '1p'
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    تک‌نفره با هوش مصنوعی
                  </button>
                  <button
                    type="button"
                    onClick={() => setGameMode('2p')}
                    className={`rounded-lg py-2 px-2 text-xs sm:text-sm font-bold transition-colors whitespace-nowrap ${
                      gameMode === '2p'
                        ? 'bg-amber-500 text-slate-950 shadow'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    دونفره روی یک گوشی
                  </button>
                </div>
              </div>

              {/* AI Difficulty Selector (shown when 1P is active) */}
              {gameMode === '1p' && (
                <div>
                  <span className="block text-xs font-bold text-slate-300 mb-1.5">
                    سطح هوش مصنوعی (AI Difficulty):
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2 p-1 rounded-xl bg-[#070a0f] border border-white/10">
                    <button
                      type="button"
                      onClick={() => setAiDifficulty('easy')}
                      className={`rounded-lg py-2 px-1.5 text-[11px] sm:text-xs font-bold transition-colors whitespace-nowrap ${
                        aiDifficulty === 'easy'
                          ? 'bg-emerald-500 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      آسان (±15°)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiDifficulty('medium')}
                      className={`rounded-lg py-2 px-1.5 text-[11px] sm:text-xs font-bold transition-colors whitespace-nowrap ${
                        aiDifficulty === 'medium'
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      متوسط (±6°)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiDifficulty('hard')}
                      className={`rounded-lg py-2 px-1.5 text-[11px] sm:text-xs font-bold transition-colors whitespace-nowrap ${
                        aiDifficulty === 'hard'
                          ? 'bg-rose-500 text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      سخت (دقیق)
                    </button>
                  </div>
                </div>
              )}

              {/* Weather / Wind Condition Selector */}
              <div>
                <span className="block text-xs font-bold text-slate-300 mb-1.5">
                  شرایط آب‌وهوا و باد (Weather & Wind):
                </span>
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2 p-1 rounded-xl bg-[#070a0f] border border-white/10">
                  <button
                    type="button"
                    onClick={() => setWeather('clear')}
                    className={`rounded-lg py-1.5 px-1.5 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap ${
                      weather === 'clear'
                        ? 'bg-sky-500 text-slate-950 font-bold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    صاف و نسیم
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeather('dust')}
                    className={`rounded-lg py-1.5 px-1.5 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap ${
                      weather === 'dust'
                        ? 'bg-amber-500 text-slate-950 font-bold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    طوفان غبار
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeather('rain')}
                    className={`rounded-lg py-1.5 px-1.5 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap ${
                      weather === 'rain'
                        ? 'bg-indigo-500 text-white font-bold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    باران و تندباد
                  </button>
                </div>
              </div>

              {/* Primary CTA & Android APK Export CTA */}
              <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <button
                  type="button"
                  data-start="true"
                  onClick={() => startMatch()}
                  className="flex-1 rounded-xl bg-amber-500 py-3 sm:py-3.5 px-5 text-sm sm:text-base font-extrabold text-slate-950 shadow-lg hover:bg-amber-400 active:scale-[0.99] transition-all whitespace-nowrap"
                >
                  شروع نبرد کمانداران
                </button>
                <button
                  type="button"
                  onClick={() => setApkModalOpen(true)}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 sm:py-3.5 px-4 text-xs sm:text-sm font-bold text-amber-300 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                >
                  خروجی اندروید (APK)
                </button>
              </div>
            </div>
          </div>

          {/* Single Flat Borderless Control-Hint Line in Bottom Safe Margin */}
          <div className="w-full text-center text-[11px] sm:text-xs text-slate-300 pointer-events-none">
            کشیدن انگشت روی صحنه برای تنظیم زاویه و قدرت · بهینه‌شده برای حالت عمودی گوشی (Portrait 3D)
          </div>
        </div>
      )}

      {/* ACTIVE GAMEPLAY HUD */}
      {appState !== 'title' && (
        <GameHud
          archers={archers}
          trailingHp={trailingHp}
          currentTurn={currentTurn}
          turnCount={turnCount}
          windSpeed={windSpeed}
          distance={arena.distance}
          gameMode={gameMode}
          aiDifficulty={aiDifficulty}
          weather={weather}
          isAITurn={isAITurn}
          isShotInFlight={isShotInFlight}
          aiStatusText={aiStatusText}
          lastImpactBanner={lastImpactBanner}
          cameraMode={cameraMode}
          cinematicFollow={cinematicFollow}
          isMuted={isMuted}
          dockCollapsed={dockCollapsed}
          onToggleDock={() => setDockCollapsed((prev) => !prev)}
          onAngleChange={(ang) => {
            soundEngine.playBowDrawCreak(archers[currentTurn - 1].powerPct);
            handleAimChange(ang, archers[currentTurn - 1].powerPct);
          }}
          onPowerChange={(pwr) => {
            soundEngine.playBowDrawCreak(pwr);
            handleAimChange(archers[currentTurn - 1].angleDeg, pwr);
          }}
          onFire={handleFire}
          onToggleMute={() => {
            const m = soundEngine.toggleMute();
            setIsMuted(m);
          }}
          onCycleCamera={() =>
            setCameraMode((prev) =>
              prev === 'auto' ? 'overview' : prev === 'overview' ? 'focus' : 'auto'
            )
          }
          onToggleCinematic={() => setCinematicFollow((prev) => !prev)}
          onNewArena={() => startMatch()}
          onPause={() => setAppState('paused')}
          onOpenApkModal={() => setApkModalOpen(true)}
        />
      )}

      {/* PAUSE MODAL */}
      {appState === 'paused' && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(8, 11, 16, 0.85)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#121824] p-6 text-center shadow-2xl space-y-5">
            <h2 id="pause-modal-title" className="text-2xl font-extrabold text-amber-400">
              توقف نبرد (Paused)
            </h2>

            <div className="grid grid-cols-3 gap-2 text-xs font-mono-num">
              <div className="rounded-lg bg-[#0c1017] p-2.5 border border-white/10">
                <div className="text-slate-400">نوبت فعلی</div>
                <div className="text-base font-bold text-white mt-0.5">{turnCount}</div>
              </div>
              <div className="rounded-lg bg-[#0c1017] p-2.5 border border-white/10">
                <div className="text-slate-400">فاصله کمانداران</div>
                <div className="text-base font-bold text-amber-400 mt-0.5">{Math.round(arena.distance)}m</div>
              </div>
              <div className="rounded-lg bg-[#0c1017] p-2.5 border border-white/10">
                <div className="text-slate-400">سرعت باد</div>
                <div className="text-base font-bold text-sky-400 mt-0.5">{Math.abs(windSpeed).toFixed(1)} m/s</div>
              </div>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setAppState('playing')}
                className="w-full rounded-xl bg-amber-500 py-3 text-sm font-extrabold text-slate-950 hover:bg-amber-400 transition-colors"
              >
                ادامه بازی (Resume) [P / Esc]
              </button>
              <button
                type="button"
                onClick={() => startMatch()}
                className="w-full rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-bold text-white hover:bg-white/10 transition-colors"
              >
                شروع مجدد با زمین ناهموار جدید (Restart)
              </button>
              <button
                type="button"
                onClick={() => setApkModalOpen(true)}
                className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 text-sm font-bold text-amber-300 hover:bg-amber-500/20 transition-colors"
              >
                دریافت خروجی اندروید (APK / PWA)
              </button>
              <button
                type="button"
                onClick={() => setAppState('title')}
                className="w-full rounded-xl border border-white/10 bg-transparent py-2.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                بازگشت به صفحه عنوان (Title Screen)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VICTORY / GAME OVER MODAL */}
      {appState === 'gameover' && matchSnapshot && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(8, 11, 16, 0.88)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="gameover-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#121824] p-6 text-center shadow-2xl space-y-5">
            <div>
              <h2
                id="gameover-modal-title"
                className={`text-2xl sm:text-3xl font-extrabold ${
                  matchSnapshot.isPlayerVictory ? 'text-amber-400' : 'text-rose-400'
                }`}
              >
                {matchSnapshot.isPlayerVictory ? 'پیروزی در نبرد کمانداران!' : 'شکست در نبرد!'}
              </h2>
              <p className="text-sm text-slate-300 mt-1">
                برنده میدان: <strong className="text-white">{matchSnapshot.winnerName}</strong>
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-xs font-mono-num">
              <div className="rounded-xl bg-[#0c1017] p-3 border border-white/10">
                <div className="text-slate-400">دقت کماندار ۱</div>
                <div className="text-lg font-extrabold text-sky-400 mt-0.5">
                  {matchSnapshot.p1Accuracy}%
                </div>
              </div>
              <div className="rounded-xl bg-[#0c1017] p-3 border border-white/10">
                <div className="text-slate-400">هدشات‌ها</div>
                <div className="text-lg font-extrabold text-amber-400 mt-0.5">
                  {matchSnapshot.p1Headshots + matchSnapshot.p2Headshots}
                </div>
              </div>
              <div className="rounded-xl bg-[#0c1017] p-3 border border-white/10">
                <div className="text-slate-400">تعداد نوبت</div>
                <div className="text-lg font-extrabold text-emerald-400 mt-0.5">
                  {matchSnapshot.turnsTaken}
                </div>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                data-start="true"
                onClick={() => startMatch()}
                className="w-full rounded-xl bg-amber-500 py-3.5 text-base font-extrabold text-slate-950 shadow-lg hover:bg-amber-400 transition-colors"
              >
                نبرد مجدد در میدان جدید [Enter / Space]
              </button>
              <button
                type="button"
                onClick={() => setAppState('title')}
                className="w-full rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-slate-200 hover:bg-white/10 transition-colors"
              >
                تغییر حالت بازی / سطح هوش مصنوعی
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ANDROID APK & PWA INSTALL MODAL */}
      <AndroidApkModal isOpen={apkModalOpen} onClose={() => setApkModalOpen(false)} />
    </main>
  );
}
