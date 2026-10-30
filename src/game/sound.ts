// Procedural Web Audio Synthesizer for Kaman Duel 3D
// Zero external MP3/WAV dependencies — generates authentic bow creaks, arrow whistle, and material impacts

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private whistleOsc: OscillatorNode | null = null;
  private whistleGain: GainNode | null = null;
  private whistleFilter: BiquadFilterNode | null = null;
  private lastDrawTickTime = 0;

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

  public setMuted(m: boolean) {
    this.muted = m;
    if (m) {
      this.stopArrowWhistle();
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
   * Subtle wooden fiber & bowstring tension creak when adjusting draw power/angle
   */
  public playBowDrawCreak(powerPct: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (now - this.lastDrawTickTime < 0.065) return;
    this.lastDrawTickTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Pitch rises with tension (powerPct 15..100)
    const baseFreq = 95 + (powerPct / 100) * 145 + (Math.random() - 0.5) * 12;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.78, now + 0.045);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(340 + powerPct * 2.5, now);
    filter.Q.setValueAtTime(4.5, now);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.055);
  }

  /**
   * Elastic bowstring twang on arrow release
   */
  public playBowRelease(powerPct: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Resonant string harmonic
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const pitch = 135 + (powerPct / 100) * 85;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch * 1.4, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.65, now + 0.22);

    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);

    // 2. Crisp feather-fletching whoosh transient
    this.playNoiseBurst(0.09, 1400, 2.0, 0.14);
  }

  /**
   * Continuous aerodynamic whistle while arrow flies through the air
   */
  public startArrowWhistle() {
    this.stopArrowWhistle();
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, now);
    filter.Q.setValueAtTime(6, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.065, now + 0.08);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    this.whistleOsc = osc;
    this.whistleFilter = filter;
    this.whistleGain = gain;
  }

  public updateArrowWhistle(speed: number, heightY: number) {
    if (!this.ctx || !this.whistleOsc || !this.whistleFilter || !this.whistleGain) return;
    const now = this.ctx.currentTime;
    const normSpeed = Math.max(0.2, Math.min(1.6, speed / 26));
    const targetFreq = 390 + normSpeed * 380 + Math.max(0, heightY) * 12;
    this.whistleOsc.frequency.setTargetAtTime(targetFreq, now, 0.04);
    this.whistleFilter.frequency.setTargetAtTime(targetFreq, now, 0.04);
    this.whistleGain.gain.setTargetAtTime(Math.min(0.09, normSpeed * 0.055), now, 0.04);
  }

  public stopArrowWhistle() {
    if (this.whistleOsc) {
      try {
        this.whistleOsc.stop();
        this.whistleOsc.disconnect();
      } catch {
        // ignore if already stopped
      }
      this.whistleOsc = null;
    }
    if (this.whistleGain) {
      this.whistleGain.disconnect();
      this.whistleGain = null;
    }
    if (this.whistleFilter) {
      this.whistleFilter.disconnect();
      this.whistleFilter = null;
    }
  }

  /**
   * Impact with flesh / armor (Headshot critical vs Body / Limbs)
   */
  public playImpactFlesh(isHeadshot: boolean) {
    this.stopArrowWhistle();
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Visceral low punch
    const punchOsc = ctx.createOscillator();
    const punchGain = ctx.createGain();
    punchOsc.type = 'sine';
    punchOsc.frequency.setValueAtTime(isHeadshot ? 175 : 130, now);
    punchOsc.frequency.exponentialRampToValueAtTime(36, now + 0.19);

    punchGain.gain.setValueAtTime(isHeadshot ? 0.42 : 0.3, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);

    punchOsc.connect(punchGain);
    punchGain.connect(ctx.destination);
    punchOsc.start(now);
    punchOsc.stop(now + 0.22);

    // Flesh crunch noise
    this.playNoiseBurst(0.11, 650, 1.4, 0.22);

    // Critical headshot helmet/bell ring
    if (isHeadshot) {
      const ringOsc = ctx.createOscillator();
      const ringGain = ctx.createGain();
      ringOsc.type = 'triangle';
      ringOsc.frequency.setValueAtTime(1180, now);
      ringOsc.frequency.exponentialRampToValueAtTime(880, now + 0.45);

      ringGain.gain.setValueAtTime(0.22, now);
      ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);

      ringOsc.connect(ringGain);
      ringGain.connect(ctx.destination);
      ringOsc.start(now);
      ringOsc.stop(now + 0.48);
    }
  }

  /**
   * Impact with wooden barrel or timber obstacle
   */
  public playImpactWood(destroyed: boolean) {
    this.stopArrowWhistle();
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const freqs = destroyed ? [180, 245, 330, 120] : [210, 295];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      const start = now + idx * 0.025;
      osc.frequency.setValueAtTime(f, start);
      osc.frequency.exponentialRampToValueAtTime(f * 0.52, start + 0.14);

      gain.gain.setValueAtTime(0.16, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });

    this.playNoiseBurst(destroyed ? 0.26 : 0.12, 480, 1.8, destroyed ? 0.28 : 0.16);
  }

  /**
   * Impact with stone boulder or castle wall masonry
   */
  public playImpactStone(destroyed: boolean) {
    this.stopArrowWhistle();
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Sharp flint ricochet ping
    const ping = ctx.createOscillator();
    const pingGain = ctx.createGain();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(1650 + Math.random() * 250, now);
    ping.frequency.exponentialRampToValueAtTime(420, now + 0.14);

    pingGain.gain.setValueAtTime(0.2, now);
    pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    ping.connect(pingGain);
    pingGain.connect(ctx.destination);
    ping.start(now);
    ping.stop(now + 0.16);

    // Rock crumble noise
    this.playNoiseBurst(destroyed ? 0.35 : 0.12, destroyed ? 260 : 950, 1.2, destroyed ? 0.32 : 0.18);
  }

  /**
   * Impact with earth/sand terrain
   */
  public playImpactDirt() {
    this.stopArrowWhistle();
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.14);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);

    this.playNoiseBurst(0.1, 320, 1.1, 0.14);
  }

  /**
   * Victory or Defeat fanfare sting
   */
  public playMatchEnd(victory: boolean) {
    this.stopArrowWhistle();
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = victory ? [261.63, 329.63, 392.0, 523.25] : [293.66, 261.63, 220.0, 174.61];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.12;
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  private playNoiseBurst(duration: number, centerFreq: number, q: number, volume: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.45));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(centerFreq, now);
    filter.Q.setValueAtTime(q, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration);
  }
}

export const soundEngine = new SoundEngine();
