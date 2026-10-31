import React from 'react';
import {
  SHELL_CATALOG,
  type CameraPreset,
  type ShellSpec,
  type TankCombatState,
} from '../game/physics';

interface GameHudProps {
  tanks: [TankCombatState, TankCombatState];
  trailingHp: [number, number];
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
  onMoveTank: (dx: number, dz: number) => void;
  onSelectShell: (shell: ShellSpec) => void;
  onFire: () => void;
  onCycleCamera: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onOpenApkModal: () => void;
}

const CAMERA_LABELS: Record<CameraPreset, string> = {
  tactical: 'دوربین ۱: مورب تاکتیکی',
  turret: 'دوربین ۲: پشت برجک',
  side: 'دوربین ۳: نمای بغل',
  drone: 'دوربین ۴: پهپاد بالا',
  cinematic: 'دوربین ۵: تعقیب گلوله',
};

export const GameHud: React.FC<GameHudProps> = ({
  tanks,
  trailingHp,
  currentTurn,
  stageNumber,
  biomeTitle,
  coins,
  windSpeed,
  unlockedShellIds,
  selectedShellId,
  isAITurn,
  isShotInFlight,
  lastImpactBanner,
  cameraPreset,
  isMuted,
  onMoveTank,
  onSelectShell,
  onFire,
  onCycleCamera,
  onToggleMute,
  onPause,
  onOpenApkModal,
}) => {
  const p1 = tanks[0];
  const p2 = tanks[1];
  const controlsDisabled = isAITurn || isShotInFlight || currentTurn !== 1;
  const absWind = Math.abs(windSpeed);
  const windDirRight = windSpeed >= 0;

  const p1HpPct = Math.max(0, Math.min(100, (p1.hp / p1.maxHp) * 100));
  const p2HpPct = Math.max(0, Math.min(100, (p2.hp / p2.maxHp) * 100));
  const p1TrailPct = Math.max(0, Math.min(100, (trailingHp[0] / p1.maxHp) * 100));
  const p2TrailPct = Math.max(0, Math.min(100, (trailingHp[1] / p2.maxHp) * 100));
  const fuelPct = Math.max(0, Math.min(100, (p1.moveFuel / p1.maxMoveFuel) * 100));

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2.5 sm:p-4">
      {/* TOP PERIMETER BAR: Player Tank Health | Stage, Coins, Wind & 5-Camera Selector | Enemy Tank Health */}
      <div className="w-full max-w-[1400px] mx-auto" dir="ltr">
        <div className="grid grid-cols-2 lg:grid-cols-12 gap-2 sm:gap-3 items-start">
          {/* LEFT: PLAYER TANK VITALITY */}
          <div
            className={`pointer-events-auto col-span-1 lg:col-span-4 order-1 rounded-xl border px-2.5 py-2 sm:px-3.5 sm:py-2.5 transition-colors ${
              currentTurn === 1
                ? 'border-emerald-400/80 bg-[#0c1914]/92 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                : 'border-white/10 bg-[#0c1017]/88'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-[11px] sm:text-sm font-bold text-emerald-300 truncate" dir="rtl">
                  {p1.model.name} {currentTurn === 1 ? '· نوبت شما' : ''}
                </span>
              </div>
              <span className="font-mono-num text-xs sm:text-base font-bold text-white stroke-text whitespace-nowrap shrink-0">
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
              {p1.tracksDamaged && (
                <span className="text-amber-400 font-bold">شنی آسیب‌دیده (-۵۰٪ حرکت)</span>
              )}
            </div>
          </div>

          {/* RIGHT: ENEMY TANK VITALITY (Equal Starting HP) */}
          <div
            className={`pointer-events-auto col-span-1 lg:col-span-4 order-2 lg:order-3 rounded-xl border px-2.5 py-2 sm:px-3.5 sm:py-2.5 transition-colors ${
              currentTurn === 2
                ? 'border-rose-400/80 bg-[#240d14]/92 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
                : 'border-white/10 bg-[#0c1017]/88'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="font-mono-num text-xs sm:text-base font-bold text-white stroke-text whitespace-nowrap shrink-0">
                {Math.round(p2.hp)} <span className="text-[10px] text-slate-400">/ {p2.maxHp}</span>
              </span>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] sm:text-sm font-bold text-rose-300 truncate" dir="rtl">
                  دشمن: {p2.model.name}
                </span>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
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
              {p2.tracksDamaged ? (
                <span className="text-amber-400 font-bold">شنی دشمن آسیب‌دیده</span>
              ) : (
                <span className="text-slate-400 truncate">{biomeTitle}</span>
              )}
            </div>
          </div>

          {/* CENTER: STAGE, COINS, WIND & 5-CAMERA ANGLE SELECTOR */}
          <div className="col-span-2 lg:col-span-4 order-3 lg:order-2 flex items-center justify-between gap-1.5 sm:gap-2">
            <div className="pointer-events-auto flex-1 flex items-center justify-between rounded-xl border border-amber-500/30 bg-[#0c1017]/90 px-2.5 py-1.5 sm:px-3.5 sm:py-2 shadow-xl">
              {/* Coin Balance */}
              <div className="flex items-center gap-1 text-amber-400 font-bold text-xs sm:text-sm font-mono-num">
                <span>🪙</span>
                <span>{coins}</span>
              </div>

              {/* Wind Speed & Direction */}
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
                <span className="font-mono-num text-xs sm:text-sm font-extrabold text-white">
                  {absWind.toFixed(1)}
                </span>
              </div>

              {/* 5-Camera Angle Cycle Button */}
              <button
                type="button"
                onClick={onCycleCamera}
                className="rounded-lg border border-sky-400/40 bg-sky-500/15 px-2 py-1 text-[10px] sm:text-xs font-bold text-sky-300 hover:bg-sky-500/25 transition-colors whitespace-nowrap"
                dir="rtl"
              >
                🎥 {CAMERA_LABELS[cameraPreset]}
              </button>
            </div>

            {/* Pause, Mute & APK Buttons */}
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
              <button
                type="button"
                aria-label="خروجی APK"
                onClick={onOpenApkModal}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-amber-500/40 bg-[#0c1017]/90 flex items-center justify-center text-amber-400 hover:bg-amber-500/20"
                title="خروجی APK کافه‌بازار و مایکت"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <path d="M12 18h.01" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CENTER IMPACT / CRATE / ENEMY TURN CALLOUT */}
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

        {isAITurn && !isShotInFlight && (
          <div className="mt-2 rounded-xl border border-rose-500/40 bg-[#1a0c12]/90 px-4 py-2 text-center shadow-lg">
            <div className="text-xs font-bold text-rose-300">تانک دشمن در حال حرکت و نشانه‌گیری...</div>
          </div>
        )}
      </div>

      {/* BOTTOM TACTICAL DOCK: Movement D-Pad + Shell Selector + Fire Cannon Button (NO Angle/Power Numbers or Guide Menus!) */}
      <div className="w-full max-w-[820px] mx-auto pointer-events-auto">
        <div className="rounded-2xl border border-white/15 bg-[#0c1017]/92 p-2.5 sm:px-4 sm:py-3 shadow-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-4">
          {/* 1. 4-WAY TANK MOVEMENT D-PAD (Forward / Backward / Left / Right) */}
          <div className="flex items-center justify-between sm:justify-start gap-2.5 bg-[#131926] rounded-xl px-3 py-2 border border-white/10">
            <div className="flex flex-col gap-1 min-w-[76px]">
              <span className="text-[10px] sm:text-xs font-bold text-slate-200">حرکت تانک</span>
              <div className="h-2 w-full rounded bg-slate-950 overflow-hidden border border-white/10">
                <div
                  className="h-full bg-emerald-400 transition-all duration-150"
                  style={{ width: `${fuelPct}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-400 font-mono-num">
                سوخت: {p1.moveFuel.toFixed(1)}m
              </span>
            </div>

            <div className="flex items-center gap-1" dir="ltr">
              <button
                type="button"
                disabled={controlsDisabled || p1.moveFuel <= 0.1}
                onClick={() => onMoveTank(-1.1, 0)}
                className="px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-white disabled:opacity-35 active:scale-95"
                title="حرکت به عقب"
              >
                ◀ عقب
              </button>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={controlsDisabled || p1.moveFuel <= 0.1}
                  onClick={() => onMoveTank(0, -0.9)}
                  className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[10px] font-bold text-slate-200 disabled:opacity-35 active:scale-95"
                >
                  ▲ چپ
                </button>
                <button
                  type="button"
                  disabled={controlsDisabled || p1.moveFuel <= 0.1}
                  onClick={() => onMoveTank(0, 0.9)}
                  className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[10px] font-bold text-slate-200 disabled:opacity-35 active:scale-95"
                >
                  ▼ راست
                </button>
              </div>
              <button
                type="button"
                disabled={controlsDisabled || p1.moveFuel <= 0.1}
                onClick={() => onMoveTank(1.1, 0)}
                className="px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-white disabled:opacity-35 active:scale-95"
                title="حرکت به جلو"
              >
                جلو ▶
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
                  disabled={controlsDisabled}
                  onClick={() => onSelectShell(shell)}
                  className={`rounded-xl border px-2.5 py-2 text-[11px] font-bold transition-all whitespace-nowrap ${
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
            disabled={controlsDisabled}
            onClick={onFire}
            className="flex-1 sm:flex-initial sm:min-w-[190px] rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 text-sm sm:text-base font-extrabold text-slate-950 shadow-lg hover:from-amber-400 hover:to-orange-400 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {isShotInFlight
              ? 'شلیک شد...'
              : isAITurn
                ? 'نوبت تانک دشمن...'
                : '🔥 آتش / شلیک توپ'}
          </button>
        </div>
      </div>
    </div>
  );
};
