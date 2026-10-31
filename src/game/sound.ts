/**
 * Pure Procedural Web Audio Synthesizer for Tank Wars 3D (جنگ تانک‌ها):
 * - Heavy Tank Cannon Muzzle Blast (Sub-bass + Breech Clank)
 * - Diesel Engine & Metallic Track Clatter during movement
 * - Hydraulic Turret Servo Whir during barrel elevation
 * - Supersonic Incoming Shell Whistle
 * - Armor Penetration / Ricochet / Massive Tank Explosion
 * - Coin & Supply Crate Pickup Chimes
 */

class TankSoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private whistleOsc: OscillatorNode | null = null;
  private whistleGain: GainNode | null = null;
  private lastServoMs: number = 0;
  private lastTrackMs: number = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (mute) {
      this.stopShellWhistle();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Hydraulic turret elevation servo sound when aiming the tank barrel.
   */
  public playTurretServo(powerPct: number): void {
    const nowMs = performance.now();
    if (nowMs - this.lastServoMs < 65) return;
    this.lastServoMs = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreq = 140 + (powerPct / 100) * 110;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.08, now + 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 320;
    filter.Q.value = 3.5;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.04, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  /**
   * Diesel engine rumble and metallic track link clatter when repositioning the tank.
   */
  public playTrackMove(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastTrackMs < 90) return;
    this.lastTrackMs = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(58, now);
    osc.frequency.linearRampToValueAtTime(74, now + 0.06);
    osc.frequency.linearRampToValueAtTime(52, now + 0.11);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.13);
  }

  /**
   * Heavy tank cannon muzzle blast (sub-bass concussion + noise burst).
   */
  public playCannonBlast(barrelCount: 1 | 2 = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const triggerSingleBlast = (offsetSec: number) => {
      const now = ctx.currentTime + offsetSec;

      // 1. Sub-bass cannon thump
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.38);

      oscGain.gain.setValueAtTime(0.45, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.42);

      // 2. Explosive muzzle shockwave noise
      const bufferSize = Math.floor(ctx.sampleRate * 0.32);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(950, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 0.3);

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.38, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(ctx.destination);
      noise.start(now);
    };

    triggerSingleBlast(0);
    if (barrelCount === 2) {
      triggerSingleBlast(0.07);
    }
  }

  /**
   * Fires cannon blast scaled by shell damage multiplier.
   */
  public playCannonFire(damageMultiplier = 1.0): void {
    this.playCannonBlast(damageMultiplier >= 1.45 ? 2 : 1);
  }

  /**
   * Unified explosion sound dispatcher for armor hits, turret crits, obstacles, and ground craters.
   */
  public playExplosion(
    kind: 'turret_crit' | 'armor' | 'obstacle' | 'ground',
    isFatal = false
  ): void {
    if (isFatal) {
      this.playTankExplosion();
      return;
    }
    if (kind === 'turret_crit') {
      this.playImpactArmor(true);
    } else if (kind === 'armor' || kind === 'obstacle') {
      this.playImpactArmor(false);
    } else {
      this.playImpactGround();
    }
  }

  /**
   * Starts continuous artillery shell whistle during flight.
   */
  public startShellWhistle(): void {
    this.stopShellWhistle();
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);

    this.whistleOsc = osc;
    this.whistleGain = gain;
  }

  public updateShellWhistle(speed: number, vy: number): void {
    if (!this.whistleOsc || !this.whistleGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Falling shells whistle downward in pitch like classic artillery
    const pitch = Math.max(260, Math.min(980, 480 + speed * 8 - Math.max(0, -vy) * 11));
    this.whistleOsc.frequency.setTargetAtTime(pitch, now, 0.04);
  }

  public stopShellWhistle(): void {
    if (this.whistleGain && this.ctx) {
      try {
        this.whistleGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02);
      } catch {
        // Ignore
      }
    }
    if (this.whistleOsc) {
      try {
        this.whistleOsc.stop(this.ctx.currentTime + 0.04);
      } catch {
        // Ignore
      }
    }
    this.whistleOsc = null;
    this.whistleGain = null;
  }

  /**
   * Armor impact (Turret critical ring vs Hull/Tracks metallic punch).
   */
  public playImpactArmor(isCriticalTurret: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Deep armor explosion punch
    const punchOsc = ctx.createOscillator();
    const punchGain = ctx.createGain();
    punchOsc.type = 'triangle';
    punchOsc.frequency.setValueAtTime(isCriticalTurret ? 190 : 130, now);
    punchOsc.frequency.exponentialRampToValueAtTime(32, now + 0.28);

    punchGain.gain.setValueAtTime(0.42, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    punchOsc.connect(punchGain);
    punchGain.connect(ctx.destination);
    punchOsc.start(now);
    punchOsc.stop(now + 0.31);

    // Metallic armor clang
    if (isCriticalTurret) {
      const ringOsc = ctx.createOscillator();
      const ringGain = ctx.createGain();
      ringOsc.type = 'sine';
      ringOsc.frequency.setValueAtTime(980, now + 0.02);
      ringOsc.frequency.exponentialRampToValueAtTime(520, now + 0.35);

      ringGain.gain.setValueAtTime(0.22, now + 0.02);
      ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

      ringOsc.connect(ringGain);
      ringGain.connect(ctx.destination);
      ringOsc.start(now + 0.02);
      ringOsc.stop(now + 0.38);
    }
  }

  /**
   * Catastrophic Tank Explosion when HP reaches 0 (turret blow-off).
   */
  public playTankExplosion(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Massive low-frequency detonation
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(95, now);
    subOsc.frequency.exponentialRampToValueAtTime(18, now + 0.85);

    subGain.gain.setValueAtTime(0.55, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.92);

    // Long rumble noise
    const bufferSize = Math.floor(ctx.sampleRate * 0.85);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.42));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(620, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.8);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.48, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
  }

  public playImpactGround(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.22);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playCratePickup(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.14, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.24);
    });
  }

  public playMatchEnd(victory: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = victory ? [261.63, 329.63, 392.0, 523.25] : [311.13, 277.18, 246.94, 196.0];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = now + idx * 0.11;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.14, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  }
}

export const soundEngine = new TankSoundEngine();
