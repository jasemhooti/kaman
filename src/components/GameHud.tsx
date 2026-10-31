import React from 'react';
import type { AIDifficulty, ArcherState, GameMode, WeatherType } from '../game/physics';
import type { CameraViewMode } from '../game/ArenaCanvas';

interface GameHudProps {
  archers: [ArcherState, ArcherState];
  trailingHp: [number, number];
  currentTurn: 1 | 2;
  turnCount: number;
  windSpeed: number;
  distance: number;
  gameMode: GameMode;
  aiDifficulty: AIDifficulty;
  weather: WeatherType;
  isAITurn: boolean;
  isShotInFlight: boolean;
  aiStatusText: string;
  lastImpactBanner: { text: string; subtext: string; tone: 'crit' | 'hit' | 'miss' } | null;
  cameraMode: CameraViewMode;
  cinematicFollow: boolean;
  isMuted: boolean;
  dockCollapsed: boolean;
  onToggleDock: () => void;
  onAngleChange: (angle: number) => void;
  onPowerChange: (power: number) => void;
  onFire: () => void;
  onToggleMute: () => void;
  onCycleCamera: () => void;
  onToggleCinematic: () => void;
  onNewArena: () => void;
  onPause: () => void;
  onOpenApkModal: () => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  archers,
  trailingHp,
  currentTurn,
  turnCount,
  windSpeed,
  distance,
  gameMode,
  aiDifficulty,
  isAITurn,
  isShotInFlight,
  aiStatusText,
  lastImpactBanner,
  cameraMode,
  cinematicFollow,
  isMuted,
  dockCollapsed,
  onToggleDock,
  onAngleChange,
  onPowerChange,
  onFire,
  onToggleMute,
  onCycleCamera,
  onToggleCinematic,
  onNewArena,
  onPause,
  onOpenApkModal,
}) => {
  const p1 = archers[0];
  const p2 = archers[1];
  const activeArcher = archers[currentTurn - 1];
  const controlsDisabled = isAITurn || isShotInFlight;

  const absWind = Math.abs(windSpeed);
  const windDirRight = windSpeed >= 0;

  // Needle angle for semicircular protractor (0 deg = horizontal, 90 deg = straight up)
  const needleAngleDeg = activeArcher.angleDeg;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2.5 sm:p-4">
      {/* TOP PERIMETER BAR: Responsive Portrait Grid (2 cols on portrait mobile, 12 cols on desktop) */}
      <div className="w-full max-w-[1400px] mx-auto" dir="ltr">
        <div className="grid grid-cols-2 lg:grid-cols-12 gap-2 sm:gap-3 items-start">
          {/* LEFT ARCHER (PLAYER 1) */}
          <div
            className={`pointer-events-auto col-span-1 lg:col-span-4 order-1 rounded-xl border px-2.5 py-2 sm:px-3.5 sm:py-2.5 transition-colors ${
              currentTurn === 1
                ? 'border-sky-400/75 bg-[#0d1526]/92 shadow-[0_0_20px_rgba(56,189,248,0.2)]'
                : 'border-white/10 bg-[#0c1017]/88'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm0 4.5c1.93 0 3.5 1.57 3.5 3.5S13.93 13.5 12 13.5 8.5 11.93 8.5 10 10.07 6.5 12 6.5z" />
                </svg>
                <span className="text-[11px] sm:text-sm font-bold text-sky-300 truncate" dir="rtl">
                  {p1.name} {currentTurn === 1 ? '· نوبت' : ''}
                </span>
              </div>
              <span className="font-mono-num text-xs sm:text-base font-bold text-white stroke-text whitespace-nowrap shrink-0">
                {Math.round(p1.hp)} <span className="text-[10px] text-slate-400">HP</span>
              </span>
            </div>

            {/* Health Bar with Delayed Trailing Damage Ghost Bar */}
            <div className="mt-1.5 h-2.5 sm:h-3 w-full rounded-md bg-slate-950 p-0.5 border border-white/10 overflow-hidden relative">
              <div
                className="absolute inset-y-0.5 left-0.5 rounded-sm bg-amber-400/60 transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, trailingHp[0]))}%` }}
              />
              <div
                className="relative h-full rounded-sm bg-sky-500 transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, p1.hp))}%` }}
              />
            </div>

            <div className="mt-1 flex items-center justify-between text-[10px] sm:text-[11px] text-slate-300 font-mono-num">
              <span>Y:{p1.y >= 0 ? `+${p1.y.toFixed(1)}m` : `${p1.y.toFixed(1)}m`}</span>
              <span>HITS:{p1.hitsLanded}/{p1.shotsFired}</span>
              <span className="text-amber-300">CRIT:{p1.headshots}</span>
            </div>
          </div>

          {/* RIGHT ARCHER (PLAYER 2 OR AI) */}
          <div
            className={`pointer-events-auto col-span-1 lg:col-span-4 order-2 lg:order-3 rounded-xl border px-2.5 py-2 sm:px-3.5 sm:py-2.5 transition-colors ${
              currentTurn === 2
                ? 'border-rose-400/75 bg-[#260d14]/92 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
                : 'border-white/10 bg-[#0c1017]/88'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="font-mono-num text-xs sm:text-base font-bold text-white stroke-text whitespace-nowrap shrink-0">
                {Math.round(p2.hp)} <span className="text-[10px] text-slate-400">HP</span>
              </span>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] sm:text-sm font-bold text-rose-300 truncate" dir="rtl">
                  {p2.name}
                  {gameMode === '1p'
                    ? ` (${aiDifficulty === 'easy' ? 'آسان' : aiDifficulty === 'medium' ? 'متوسط' : 'سخت'})`
                    : ''}
                </span>
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm0 4.5c1.93 0 3.5 1.57 3.5 3.5S13.93 13.5 12 13.5 8.5 11.93 8.5 10 10.07 6.5 12 6.5z" />
                </svg>
              </div>
            </div>

            <div className="mt-1.5 h-2.5 sm:h-3 w-full rounded-md bg-slate-950 p-0.5 border border-white/10 overflow-hidden relative">
              <div
                className="absolute inset-y-0.5 right-0.5 rounded-sm bg-amber-400/60 transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, trailingHp[1]))}%` }}
              />
              <div
                className="relative h-full ml-auto rounded-sm bg-rose-500 transition-all duration-150"
                style={{ width: `${Math.max(0, Math.min(100, p2.hp))}%` }}
              />
            </div>

            <div className="mt-1 flex items-center justify-between text-[10px] sm:text-[11px] text-slate-300 font-mono-num">
              <span className="text-amber-300">CRIT:{p2.headshots}</span>
              <span>HITS:{p2.hitsLanded}/{p2.shotsFired}</span>
              <span>Y:{p2.y >= 0 ? `+${p2.y.toFixed(1)}m` : `${p2.y.toFixed(1)}m`}</span>
            </div>
          </div>

          {/* CENTER WIND & ARENA TELEMETRY + UTILITY BUTTONS */}
          <div className="col-span-2 lg:col-span-4 order-3 lg:order-2 flex items-center justify-between gap-2">
            <div className="pointer-events-auto flex-1 flex flex-col items-center rounded-xl border border-amber-500/30 bg-[#0c1017]/90 px-3 py-1.5 sm:px-4 sm:py-2 shadow-xl">
              <div className="w-full flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-300 font-mono-num">
                  <span>T{turnCount}</span>
                  <span>·</span>
                  <span>{Math.round(distance)}m</span>
                </div>

                {/* Graphical Wind Speed & Direction Indicator */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] sm:text-[11px] font-semibold text-amber-300" dir="rtl">
                    باد:
                  </span>
                  <svg
                    className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform duration-300 ${
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
                  <span className="font-mono-num text-xs sm:text-base font-extrabold text-white stroke-text">
                    {absWind.toFixed(1)} <span className="text-[10px] font-normal text-slate-300">m/s</span>
                  </span>
                </div>
              </div>

              {/* Wind Strength Segmented Bar (0 to 10 m/s) */}
              <div className="mt-1 flex items-center gap-1 w-full">
                {Array.from({ length: 10 }).map((_, idx) => {
                  const active = absWind >= idx + 0.5;
                  return (
                    <div
                      key={idx}
                      className={`h-1.5 flex-1 rounded-xs ${
                        active
                          ? idx >= 7
                            ? 'bg-rose-500'
                            : idx >= 4
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                          : 'bg-white/10'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Compact Square Utility Buttons */}
            <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                tabIndex={-1}
                aria-label="توقف بازی"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPause();
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-white/15 bg-[#0c1017]/90 flex items-center justify-center text-slate-200 hover:bg-white/10 hover:text-amber-300 transition-colors"
                title="توقف بازی [P / Esc]"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={isMuted ? 'وصل صدا' : 'قطع صدا'}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleMute();
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-white/15 bg-[#0c1017]/90 flex items-center justify-center text-slate-200 hover:bg-white/10 hover:text-amber-300 transition-colors"
                title="قطع/وصل صدا [M]"
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
                tabIndex={-1}
                aria-label="تغییر زاویه دوربین"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onCycleCamera();
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-white/15 bg-[#0c1017]/90 flex items-center justify-center text-slate-200 hover:bg-white/10 hover:text-amber-300 transition-colors"
                title={`زاویه دوربین: ${cameraMode} [C]`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label="دریافت فایل اندروید APK"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onOpenApkModal();
                }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-amber-500/40 bg-[#0c1017]/90 flex items-center justify-center text-amber-400 hover:bg-amber-500/20 transition-colors"
                title="خروجی اندروید APK"
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

      {/* CENTER CALLOUT BANNER (Headshot / Body Hit / AI Thinking / Turn Announcement) */}
      <div className="my-auto flex flex-col items-center justify-center pointer-events-none px-2">
        {lastImpactBanner && (
          <div
            className={`rounded-xl border px-4 py-2 text-center shadow-2xl transition-transform ${
              lastImpactBanner.tone === 'crit'
                ? 'border-amber-400 bg-rose-950/90 text-amber-300'
                : lastImpactBanner.tone === 'hit'
                  ? 'border-sky-400/60 bg-slate-900/90 text-white'
                  : 'border-white/15 bg-[#0c1017]/88 text-slate-300'
            }`}
          >
            <div className="text-sm sm:text-lg font-extrabold">{lastImpactBanner.text}</div>
            <div className="text-[11px] sm:text-xs text-slate-300 mt-0.5 font-mono-num">{lastImpactBanner.subtext}</div>
          </div>
        )}

        {isAITurn && !isShotInFlight && (
          <div className="mt-2 rounded-xl border border-rose-500/40 bg-[#1a0c12]/90 px-4 py-2 text-center shadow-lg">
            <div className="text-xs font-bold text-rose-300">نوبت کماندار هوش مصنوعی...</div>
            <div className="text-[11px] text-slate-300 mt-0.5">{aiStatusText}</div>
          </div>
        )}
      </div>

      {/* UNIFIED COLLAPSIBLE BOTTOM CONTROL DOCK (Optimized for One-Handed Portrait & Desktop) */}
      <div className="w-full max-w-[940px] mx-auto flex flex-col items-center pointer-events-none">
        {/* Collapse / Expand Toggle Tab */}
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleDock();
          }}
          className="pointer-events-auto mb-1 rounded-t-lg border border-b-0 border-white/15 bg-[#0c1017]/90 px-3.5 py-1 text-[10px] sm:text-[11px] font-semibold text-slate-300 hover:text-amber-300 transition-colors"
        >
          {dockCollapsed ? '▴ نمایش پنل نشانه‌گیری و کمان [H]' : '▾ حالت سینمایی / پنهان کردن پنل [H]'}
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto w-full rounded-2xl border border-white/15 bg-[#0c1017]/92 p-2.5 sm:px-4 sm:py-3 shadow-2xl">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-2 sm:gap-3.5 items-center">
              {/* 1. ANALOG NEEDLE PROTRACTOR & ANGLE CONTROL (1 col on portrait, 4 cols on desktop) */}
              <div className="col-span-1 md:col-span-4 flex items-center gap-2 sm:gap-3 bg-[#131926] rounded-xl p-2 sm:p-2.5 border border-white/10">
                {/* Analog Semicircle Protractor SVG */}
                <div className="hidden sm:flex relative w-16 h-12 shrink-0 items-end justify-center">
                  <svg viewBox="0 0 100 60" className="w-full h-full overflow-visible">
                    <path
                      d="M 10 52 A 40 40 0 0 1 90 52"
                      fill="none"
                      stroke="#334155"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    {[15, 30, 45, 60, 75].map((deg) => {
                      const rad = (deg * Math.PI) / 180;
                      const x1 = 50 + Math.cos(rad) * 34;
                      const y1 = 52 - Math.sin(rad) * 34;
                      const x2 = 50 + Math.cos(rad) * 42;
                      const y2 = 52 - Math.sin(rad) * 42;
                      return (
                        <line
                          key={deg}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="#94a3b8"
                          strokeWidth="1.5"
                        />
                      );
                    })}
                    {(() => {
                      const rad = (needleAngleDeg * Math.PI) / 180;
                      const nx = 50 + Math.cos(rad) * 38;
                      const ny = 52 - Math.sin(rad) * 38;
                      return (
                        <>
                          <line
                            x1="50"
                            y1="52"
                            x2={nx}
                            y2={ny}
                            stroke="#fbbf24"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                          <circle cx="50" cy="52" r="4" fill="#f59e0b" />
                        </>
                      );
                    })()}
                  </svg>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <label htmlFor="angle-slider" className="text-[11px] sm:text-xs font-bold text-slate-200">
                      زاویه پرتاب
                    </label>
                    <span className="font-mono-num text-xs sm:text-sm font-extrabold text-amber-400">
                      {Math.round(activeArcher.angleDeg)}°
                    </span>
                  </div>
                  <input
                    id="angle-slider"
                    type="range"
                    min={5}
                    max={85}
                    step={1}
                    disabled={controlsDisabled}
                    value={Math.round(activeArcher.angleDeg)}
                    onChange={(e) => onAngleChange(Number(e.target.value))}
                    className="mt-1 w-full accent-amber-400 cursor-pointer disabled:opacity-40"
                  />
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => onAngleChange(Math.max(5, Math.round(activeArcher.angleDeg) - 1))}
                      className="rounded bg-white/10 px-2 py-0.5 text-[10px] sm:text-[11px] font-mono-num text-slate-200 hover:bg-white/20 disabled:opacity-40"
                    >
                      -1°
                    </button>
                    <span className="text-[9px] sm:text-[10px] text-slate-400">زاویه</span>
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => onAngleChange(Math.min(85, Math.round(activeArcher.angleDeg) + 1))}
                      className="rounded bg-white/10 px-2 py-0.5 text-[10px] sm:text-[11px] font-mono-num text-slate-200 hover:bg-white/20 disabled:opacity-40"
                    >
                      +1°
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. BOWSTRING DRAW POWER GAUGE & SLIDER (1 col on portrait, 4 cols on desktop) */}
              <div className="col-span-1 md:col-span-4 flex items-center gap-2 sm:gap-3 bg-[#131926] rounded-xl p-2 sm:p-2.5 border border-white/10">
                {/* Bowstring Tension Arc SVG */}
                <div className="hidden sm:flex relative w-14 h-12 shrink-0 items-center justify-center">
                  <svg viewBox="0 0 64 64" className="w-full h-full">
                    <path
                      d="M 22 8 C 44 18, 44 46, 22 56"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                    {(() => {
                      const pullX = 22 - ((activeArcher.powerPct - 15) / 85) * 14;
                      return (
                        <>
                          <polyline
                            points={`22,8 ${pullX},32 22,56`}
                            fill="none"
                            stroke="#e2e8f0"
                            strokeWidth="1.8"
                          />
                          <line
                            x1={pullX}
                            y1="32"
                            x2={pullX + 26}
                            y2="32"
                            stroke="#38bdf8"
                            strokeWidth="2.5"
                          />
                        </>
                      );
                    })()}
                  </svg>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <label htmlFor="power-slider" className="text-[11px] sm:text-xs font-bold text-slate-200">
                      قدرت کشش زه
                    </label>
                    <span className="font-mono-num text-xs sm:text-sm font-extrabold text-sky-400">
                      {Math.round(activeArcher.powerPct)}%
                    </span>
                  </div>
                  <input
                    id="power-slider"
                    type="range"
                    min={15}
                    max={100}
                    step={1}
                    disabled={controlsDisabled}
                    value={Math.round(activeArcher.powerPct)}
                    onChange={(e) => onPowerChange(Number(e.target.value))}
                    className="mt-1 w-full accent-sky-400 cursor-pointer disabled:opacity-40"
                  />
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => onPowerChange(Math.max(15, Math.round(activeArcher.powerPct) - 5))}
                      className="rounded bg-white/10 px-2 py-0.5 text-[10px] sm:text-[11px] font-mono-num text-slate-200 hover:bg-white/20 disabled:opacity-40"
                    >
                      -5%
                    </button>
                    <span className="text-[9px] sm:text-[10px] text-slate-400">قدرت</span>
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => onPowerChange(Math.min(100, Math.round(activeArcher.powerPct) + 5))}
                      className="rounded bg-white/10 px-2 py-0.5 text-[10px] sm:text-[11px] font-mono-num text-slate-200 hover:bg-white/20 disabled:opacity-40"
                    >
                      +5%
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. PRIMARY LAUNCH CTA & CINEMATIC CAMERA TOGGLE (2 cols on portrait, 4 cols on desktop) */}
              <div className="col-span-2 md:col-span-4 flex flex-col gap-1.5 sm:gap-2">
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onFire();
                  }}
                  className="w-full rounded-xl bg-amber-500 px-4 py-2.5 sm:py-3 text-xs sm:text-base font-extrabold text-slate-950 shadow-lg hover:bg-amber-400 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isShotInFlight
                    ? 'در حال پرواز تیر...'
                    : isAITurn
                      ? 'نوبت هوش مصنوعی...'
                      : `رها کردن زه کمان · شلیک تیر`}
                </button>

                <div className="flex items-center justify-between gap-2 text-[10px] sm:text-[11px] text-slate-300">
                  <button
                    type="button"
                    onClick={onToggleCinematic}
                    className={`flex-1 rounded-lg border px-2 py-1 font-medium transition-colors whitespace-nowrap ${
                      cinematicFollow
                        ? 'border-amber-400/50 bg-amber-500/15 text-amber-300'
                        : 'border-white/10 bg-white/5 text-slate-400'
                    }`}
                  >
                    دوربین سینمایی تیر: {cinematicFollow ? 'فعال' : 'غیرفعال'}
                  </button>
                  <button
                    type="button"
                    onClick={onNewArena}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-slate-300 hover:bg-white/10 whitespace-nowrap"
                  >
                    زمین جدید [R]
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
