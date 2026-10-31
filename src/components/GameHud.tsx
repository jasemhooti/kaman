import React from 'react';
import {
  SHELL_CATALOG,
  getTankWorldAimYaw,
  type BattlefieldConfig,
  type CameraPreset,
  type ShellSpec,
  type TankCombatState,
} from '../game/physics';

interface GameHudProps {
  tanks: [TankCombatState, TankCombatState];
  trailingHp: [number, number];
  arena: BattlefieldConfig;
  currentTurn: 1 | 2;
  stageNumber: number;
  biomeTitle: string;
  coins: number;
  windSpeed: number;
  unlockedShellIds: string[];
  selectedShellId: string;
  isAITurn: boolean;
  isShotInFlight: boolean;
  lastImpactBanner: { text: string; subtext: string; tone: 'crit' | 'hit' | 'miss' } | null;
  cameraPreset: CameraPreset;
  isMuted: boolean;
  onMoveTank: (throttleStep: number, steerStep: number) => void;
  onDriveHold: (throttle: number, steer: number) => void;
  onSelectShell: (shell: ShellSpec) => void;
  onFire: () => void;
  onCycleCamera: () => void;
  onToggleMute: () => void;
  onPause: () => void;
}

const CAMERA_LABELS: Record<CameraPreset, string> = {
  tactical: 'دوربین ۱: تعقیب جهان‌آزاد',
  turret: 'دوربین ۲: دید فرمانده برجک',
  side: 'دوربین ۳: پانورامای میدان',
  drone: 'دوربین ۴: پهپاد بالا',
  cinematic: 'دوربین ۵: تعقیب گلوله',
};

export const GameHud: React.FC<GameHudProps> = ({
  tanks,
  trailingHp,
  arena,
  currentTurn,
  stageNumber,
  biomeTitle,
  coins,
  windSpeed,
  unlockedShellIds,
  selectedShellId,
  isShotInFlight,
  lastImpactBanner,
  cameraPreset,
  isMuted,
  onMoveTank,
  onDriveHold,
  onSelectShell,
  onFire,
  onCycleCamera,
  onToggleMute,
  onPause,
}) => {
  const p1 = tanks[0];
  const p2 = tanks[1];
  const absWind = Math.abs(windSpeed);
  const windDirRight = windSpeed >= 0;

  const p1HpPct = Math.max(0, Math.min(100, (p1.hp / p1.maxHp) * 100));
  const p2HpPct = Math.max(0, Math.min(100, (p2.hp / p2.maxHp) * 100));
  const p1TrailPct = Math.max(0, Math.min(100, (trailingHp[0] / p1.maxHp) * 100));
  const p2TrailPct = Math.max(0, Math.min(100, (trailingHp[1] / p2.maxHp) * 100));

  const distBetweenTanks = Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z));
  const p1AimYaw = getTankWorldAimYaw(p1);
  const radarScale = 0.42; // Maps [-100..100] world meters into [-42..42] radar SVG units

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2.5 sm:p-4">
      {/* TOP PERIMETER BAR: Player Tank Vitality | Stage, Coins, Wind & 5-Camera Selector | Enemy Tank Vitality */}
      <div className="w-full max-w-[1400px] mx-auto" dir="ltr">
        <div className="grid grid-cols-2 lg:grid-cols-12 gap-2 sm:gap-3 items-start">
          {/* LEFT: PLAYER TANK VITALITY + COMPACT OPEN-WORLD RADAR */}
          <div className="col-span-1 lg:col-span-4 order-1 flex flex-col gap-2">
            <div
              className={`pointer-events-auto rounded-xl border px-2.5 py-2 sm:px-3.5 sm:py-2.5 transition-colors ${
                currentTurn === 1
                  ? 'border-emerald-400/80 bg-[#0c1914]/92 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                  : 'border-white/15 bg-[#0c1017]/90'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11px] sm:text-sm font-bold text-emerald-300 truncate" dir="rtl">
                    {p1.model.name} · جهان‌آزاد
                  </span>
                </div>
                <span className="font-mono-num text-xs sm:text-base font-bold text-white stroke-text whitespace-nowrap shrink-0 tabular-nums">
                  {Math.round(p1.hp)} <span className="text-[10px] text-slate-400">/ {p1.maxHp}</span>
                </span>
              </div>

              <div className="mt-1.5 h-2.5 sm:h-3 w-full rounded-md bg-slate-950 p-0.5 border border-white/10 overflow-hidden relative">
                <div
                  className="absolute inset-y-0.5 left-0.5 rounded-sm bg-amber-400/60 transition-all duration-500"
                  style={{ width: `${p1TrailPct}%` }}
                />
                <div
                  className="relative h-full rounded-sm bg-emerald-500 transition-all duration-150"
                  style={{ width: `${p1HpPct}%` }}
                />
              </div>

              <div className="mt-1 flex items-center justify-between text-[10px] sm:text-[11px] text-slate-300" dir="rtl">
                <span>گلوله: {p1.shell.name.split(' ')[1]} (∞)</span>
                <span className="font-mono-num text-amber-300 font-bold tabular-nums">
                  فاصله تا دشمن: {distBetweenTanks}m
                </span>
              </div>
            </div>

            {/* LIVE 360-DEGREE OPEN-WORLD RADAR MINIMAP */}
            <div className="hidden sm:flex items-center gap-2.5 self-start rounded-xl border border-emerald-500/30 bg-[#091118]/90 p-2 shadow-xl">
              <svg
                viewBox="-50 -50 100 100"
                className="w-20 h-20 rounded-full border border-emerald-500/40 bg-[#061014]"
              >
                <circle cx="0" cy="0" r="46" fill="none" stroke="rgba(16,185,129,0.18)" strokeWidth="1" />
                <circle cx="0" cy="0" r="24" fill="none" stroke="rgba(16,185,129,0.14)" strokeWidth="1" />
                <line x1="-48" y1="0" x2="48" y2="0" stroke="rgba(16,185,129,0.15)" strokeWidth="1" />
                <line x1="0" y1="-48" x2="0" y2="48" stroke="rgba(16,185,129,0.15)" strokeWidth="1" />

                {/* Obstacles on Radar */}
                {arena.obstacles.map((obs) =>
                  obs.destroyed ? null : (
                    <rect
                      key={obs.id}
                      x={obs.x * radarScale - 1.5}
                      y={obs.z * radarScale - 1.5}
                      width="3"
                      height="3"
                      fill="#64748b"
                    />
                  )
                )}

                {/* Supply Crates on Radar */}
                {arena.crates.map((c) =>
                  c.collected ? null : (
                    <circle
                      key={c.id}
                      cx={c.x * radarScale}
                      cy={c.z * radarScale}
                      r="2.4"
                      fill={c.kind === 'heal' ? '#38bdf8' : '#fbbf24'}
                    />
                  )
                )}

                {/* Player Aim Line */}
                <line
                  x1={p1.x * radarScale}
                  y1={p1.z * radarScale}
                  x2={p1.x * radarScale + Math.cos(p1AimYaw) * 16}
                  y2={p1.z * radarScale + Math.sin(p1AimYaw) * 16}
                  stroke="#fbbf24"
                  strokeWidth="1.5"
                  strokeDasharray="2 2"
                />

                {/* Player Tank Dot */}
                <circle
                  cx={p1.x * radarScale}
                  cy={p1.z * radarScale}
                  r="3.6"
                  fill="#10b981"
                  stroke="#ffffff"
                  strokeWidth="1"
                />

                {/* Enemy Tank Dot */}
                {p2.hp > 0 && (
                  <circle
                    cx={p2.x * radarScale}
                    cy={p2.z * radarScale}
                    r="3.8"
                    fill="#f43f5e"
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                )}
              </svg>
              <div className="text-[10px] text-slate-300 space-y-0.5 pr-1" dir="rtl">
                <div className="font-bold text-emerald-400">رادار جهان‌آزاد</div>
                <div>🟢 تانک شما</div>
                <div>🔴 تانک دشمن</div>
                <div>🟡 جعبه‌های مهمات</div>
              </div>
            </div>
          </div>

          {/* RIGHT: ENEMY TANK VITALITY */}
          <div
            className={`pointer-events-auto col-span-1 lg:col-span-4 order-2 lg:order-3 rounded-xl border px-2.5 py-2 sm:px-3.5 sm:py-2.5 transition-colors ${
              currentTurn === 2
                ? 'border-rose-400/80 bg-[#240d14]/92 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
                : 'border-white/15 bg-[#0c1017]/90'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="font-mono-num text-xs sm:text-base font-bold text-white stroke-text whitespace-nowrap shrink-0 tabular-nums">
                {Math.round(p2.hp)} <span className="text-[10px] text-slate-400">/ {p2.maxHp}</span>
              </span>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] sm:text-sm font-bold text-rose-300 truncate" dir="rtl">
                  دشمن: {p2.model.name}
                </span>
              </div>
            </div>

            <div className="mt-1.5 h-2.5 sm:h-3 w-full rounded-md bg-slate-950 p-0.5 border border-white/10 overflow-hidden relative">
              <div
                className="absolute inset-y-0.5 right-0.5 rounded-sm bg-amber-400/60 transition-all duration-500"
                style={{ width: `${p2TrailPct}%` }}
              />
              <div
                className="relative h-full ml-auto rounded-sm bg-rose-500 transition-all duration-150"
                style={{ width: `${p2HpPct}%` }}
              />
            </div>

            <div className="mt-1 flex items-center justify-between text-[10px] sm:text-[11px] text-slate-300" dir="rtl">
              <span>مرحله {stageNumber}</span>
              <span className="text-slate-400 truncate">{biomeTitle}</span>
            </div>
          </div>

          {/* CENTER: STAGE, COINS, WIND & 5-CAMERA ANGLE SELECTOR */}
          <div className="col-span-2 lg:col-span-4 order-3 lg:order-2 flex items-center justify-between gap-1.5 sm:gap-2">
            <div className="pointer-events-auto flex-1 flex items-center justify-between rounded-xl border border-amber-500/30 bg-[#0c1017]/90 px-2.5 py-1.5 sm:px-3.5 sm:py-2 shadow-xl">
              <div className="flex items-center gap-1 text-amber-400 font-bold text-xs sm:text-sm font-mono-num tabular-nums">
                <span>🪙</span>
                <span>{coins}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] sm:text-xs font-semibold text-slate-300" dir="rtl">
                  باد:
                </span>
                <svg
                  className={`w-4 h-4 transition-transform duration-300 ${
                    absWind > 6 ? 'text-rose-400' : absWind > 3 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                  style={{ transform: windDirRight ? 'rotate(0deg)' : 'rotate(180deg)' }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="3" y1="12" x2="20" y2="12" />
                  <polyline points="14 6 20 12 14 18" />
                </svg>
                <span className="font-mono-num text-xs sm:text-sm font-extrabold text-white tabular-nums">
                  {absWind.toFixed(1)}
                </span>
              </div>

              <button
                type="button"
                onClick={onCycleCamera}
                className="rounded-lg border border-sky-400/40 bg-sky-500/15 px-2 py-1 text-[10px] sm:text-xs font-bold text-sky-300 hover:bg-sky-500/25 transition-colors whitespace-nowrap shrink-0"
                dir="rtl"
              >
                🎥 {CAMERA_LABELS[cameraPreset]}
              </button>
            </div>

            {/* Pause & Mute Buttons */}
            <div className="pointer-events-auto flex items-center gap-1 shrink-0">
              <button
                type="button"
                aria-label="گاراژ و توقف"
                onClick={onPause}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-white/15 bg-[#0c1017]/90 flex items-center justify-center text-slate-200 hover:bg-white/10 hover:text-amber-300"
                title="گاراژ / توقف"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={isMuted ? 'وصل صدا' : 'قطع صدا'}
                onClick={onToggleMute}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-white/15 bg-[#0c1017]/90 flex items-center justify-center text-slate-200 hover:bg-white/10"
              >
                {isMuted ? (
                  <svg className="w-4 h-4 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CENTER IMPACT / CRATE CALLOUT */}
      <div className="my-auto flex flex-col items-center justify-center pointer-events-none px-2">
        {lastImpactBanner && (
          <div
            className={`rounded-xl border px-4 py-2 text-center shadow-2xl ${
              lastImpactBanner.tone === 'crit'
                ? 'border-amber-400 bg-rose-950/90 text-amber-300'
                : lastImpactBanner.tone === 'hit'
                  ? 'border-emerald-400/60 bg-slate-900/90 text-white'
                  : 'border-white/15 bg-[#0c1017]/88 text-slate-300'
            }`}
          >
            <div className="text-sm sm:text-lg font-extrabold">{lastImpactBanner.text}</div>
            <div className="text-[11px] sm:text-xs text-slate-300 mt-0.5">{lastImpactBanner.subtext}</div>
          </div>
        )}
      </div>

      {/* BOTTOM TACTICAL DOCK: 360-Degree Open-World Driving + Shell Switcher + Fire Cannon Button */}
      <div className="w-full max-w-[860px] mx-auto pointer-events-auto">
        <div className="rounded-2xl border border-white/15 bg-[#0c1017]/92 p-2.5 sm:px-4 sm:py-3 shadow-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-4">
          {/* 1. 360-DEGREE OPEN-WORLD TANK DRIVING CONTROLS (Hold or Tap + WASD/Arrows) */}
          <div className="flex items-center justify-between sm:justify-start gap-2.5 bg-[#131926] rounded-xl px-3 py-2 border border-white/10">
            <div className="flex flex-col gap-0.5 min-w-[78px]">
              <span className="text-[10px] sm:text-xs font-bold text-emerald-300">
                رانندگی جهان‌آزاد
              </span>
              <span className="text-[9px] text-slate-400">
                حرکت آزاد ۳۶۰° (WASD)
              </span>
            </div>

            <div className="flex items-center gap-1" dir="ltr">
              <button
                type="button"
                onPointerDown={() => onDriveHold(0, 1)}
                onPointerUp={() => onDriveHold(0, 0)}
                onPointerLeave={() => onDriveHold(0, 0)}
                onClick={() => onMoveTank(0, 1)}
                className="px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-white active:scale-95 whitespace-nowrap"
                title="چرخش به چپ (A)"
              >
                ◀ چپ
              </button>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onPointerDown={() => onDriveHold(1, 0)}
                  onPointerUp={() => onDriveHold(0, 0)}
                  onPointerLeave={() => onDriveHold(0, 0)}
                  onClick={() => onMoveTank(1, 0)}
                  className="px-3 py-1 rounded-md bg-emerald-500/25 border border-emerald-400/40 hover:bg-emerald-500/35 text-[10px] font-extrabold text-emerald-200 active:scale-95 whitespace-nowrap"
                  title="حرکت به جلو (W)"
                >
                  ▲ جلو
                </button>
                <button
                  type="button"
                  onPointerDown={() => onDriveHold(-1, 0)}
                  onPointerUp={() => onDriveHold(0, 0)}
                  onPointerLeave={() => onDriveHold(0, 0)}
                  onClick={() => onMoveTank(-1, 0)}
                  className="px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[10px] font-bold text-slate-200 active:scale-95 whitespace-nowrap"
                  title="حرکت به عقب (S)"
                >
                  ▼ عقب
                </button>
              </div>
              <button
                type="button"
                onPointerDown={() => onDriveHold(0, -1)}
                onPointerUp={() => onDriveHold(0, 0)}
                onPointerLeave={() => onDriveHold(0, 0)}
                onClick={() => onMoveTank(0, -1)}
                className="px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-white active:scale-95 whitespace-nowrap"
                title="چرخش به راست (D)"
              >
                راست ▶
              </button>
            </div>
          </div>

          {/* 2. EQUIPPED SHELL SWITCHER (Unlimited Ammo for Unlocked Shells) */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            {SHELL_CATALOG.filter((s) => unlockedShellIds.includes(s.id)).map((shell) => {
              const active = shell.id === selectedShellId;
              return (
                <button
                  key={shell.id}
                  type="button"
                  onClick={() => onSelectShell(shell)}
                  className={`rounded-xl border px-2.5 py-2 text-[11px] font-bold transition-all whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow'
                      : 'border-white/10 bg-[#131926] text-slate-300 hover:text-white'
                  }`}
                >
                  {shell.name.split('(')[0].trim()} (∞)
                </button>
              );
            })}
          </div>

          {/* 3. FIRE CANNON BUTTON */}
          <button
            type="button"
            disabled={isShotInFlight}
            onClick={onFire}
            className="flex-1 sm:flex-initial sm:min-w-[190px] rounded-xl bg-amber-500 px-5 py-3 text-sm sm:text-base font-extrabold text-slate-950 shadow-lg hover:bg-amber-400 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
          >
            {isShotInFlight ? 'در حال پرواز گلوله...' : '🔥 آتش / شلیک توپ'}
          </button>
        </div>
      </div>
    </div>
  );
};
