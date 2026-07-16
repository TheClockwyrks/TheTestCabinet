// Shatter — optional synthesized audio (Web Audio API, no audio files).
//
// Distinct short sounds for firing, a rock shattering, the ship's thrust (a
// held rumble), the saucer's presence, and the ship being destroyed, plus a
// chime for an extra ship. Audio is never required for the game to run: if the
// AudioContext is unavailable or muted, every call is a no-op. Nothing plays
// until the first user gesture resumes the context (see Input.onFirstPress).

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  // The held thrust rumble.
  private thrustGain: GainNode | null = null;
  private thrustOn = false;

  muted = false;

  // Called on the first user gesture so autoplay policy is respected.
  resume(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.muted) this.setThrust(false);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number,
    delay = 0,
  ): void {
    if (this.muted || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + dur);
    }
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private burst(dur: number, gain: number, cutoff: number): void {
    if (this.muted || !this.ctx || !this.master || !this.noise) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = cutoff;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filt);
    filt.connect(env);
    env.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  fire(): void {
    this.tone(720, 0.09, "square", 0.16, 340);
  }
  shatter(): void {
    this.burst(0.22, 0.5, 1600);
    this.tone(180, 0.12, "triangle", 0.12, 90);
  }
  saucer(): void {
    this.tone(300, 0.5, "sawtooth", 0.1, 420);
  }
  death(): void {
    this.burst(0.5, 0.6, 900);
    this.tone(320, 0.6, "sawtooth", 0.2, 60);
  }
  extraLife(): void {
    this.tone(520, 0.1, "triangle", 0.18, 700, 0);
    this.tone(780, 0.14, "triangle", 0.16, 980, 0.1);
  }

  // A held low rumble while the ship thrusts.
  setThrust(on: boolean): void {
    if (this.muted || !this.ctx || !this.master) {
      this.thrustOn = on && !this.muted;
      return;
    }
    if (on && !this.thrustOn) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 70;
      env.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.09, this.ctx.currentTime + 0.05);
      osc.connect(env);
      env.connect(this.master);
      osc.start();
      this.thrustGain = env;
      // Keep a handle to stop it later via the gain node's owner.
      (env as unknown as { __osc?: OscillatorNode }).__osc = osc;
      this.thrustOn = true;
    } else if (!on && this.thrustOn && this.thrustGain) {
      const env = this.thrustGain;
      const osc = (env as unknown as { __osc?: OscillatorNode }).__osc;
      const t = this.ctx.currentTime;
      env.gain.cancelScheduledValues(t);
      env.gain.setValueAtTime(env.gain.value, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      if (osc) osc.stop(t + 0.1);
      this.thrustGain = null;
      this.thrustOn = false;
    }
  }
}
