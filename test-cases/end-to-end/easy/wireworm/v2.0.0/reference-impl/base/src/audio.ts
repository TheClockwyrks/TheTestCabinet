// Synthesized audio (specs/flow.md). All cues are generated with the Web Audio
// API — no audio files. Audio is optional and never required to run: it stays
// silent until the first user gesture (browsers block autoplay) and can be muted
// with M. A missing/unsupported AudioContext degrades to no-ops.

type CueName =
  | "fire"
  | "cut"
  | "discharge"
  | "critical"
  | "foe"
  | "life"
  | "level"
  | "victory"
  | "gameover"
  | "menu";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): void {
    if (this.ctx) return;
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
    } catch {
      this.ctx = null;
    }
  }

  // Call on a user gesture to unlock the context.
  resume(): void {
    this.ensure();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, delay = 0): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  play(cue: CueName): void {
    if (!this.ctx || this.muted) return;
    switch (cue) {
      case "fire":
        this.tone("square", 720, 1180, 0.07, 0.12);
        break;
      case "cut":
        this.tone("sawtooth", 300, 150, 0.1, 0.15);
        this.noise(0.06, 0.06);
        break;
      case "discharge":
        this.tone("sawtooth", 180, 900, 0.05, 0.18);
        this.tone("square", 900, 120, 0.4, 0.16, 0.03);
        this.noise(0.35, 0.14);
        break;
      case "critical":
        this.tone("sine", 1200, 1600, 0.12, 0.1);
        break;
      case "foe":
        this.tone("square", 520, 900, 0.09, 0.14);
        this.tone("square", 900, 520, 0.09, 0.1, 0.05);
        break;
      case "life":
        this.tone("sawtooth", 400, 60, 0.5, 0.2);
        this.noise(0.3, 0.1);
        break;
      case "level":
        this.tone("triangle", 500, 760, 0.12, 0.16);
        this.tone("triangle", 760, 1020, 0.14, 0.16, 0.1);
        break;
      case "victory":
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone("triangle", f, f, 0.2, 0.18, i * 0.14),
        );
        break;
      case "gameover":
        [440, 349, 262, 196].forEach((f, i) =>
          this.tone("sawtooth", f, f * 0.98, 0.28, 0.16, i * 0.16),
        );
        break;
      case "menu":
        this.tone("square", 600, 640, 0.05, 0.08);
        break;
    }
  }
}
