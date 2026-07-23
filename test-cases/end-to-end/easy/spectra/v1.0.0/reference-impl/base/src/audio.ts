// Spectra — synthesized audio (specs/gameplay.md, Audio).
//
// Optional and never required for the game to run. All cues are synthesized with
// the Web Audio API (no audio files). Audio does not start until the first user
// gesture (browsers block autoplay); a mute toggle (`M`) is provided.

export type Cue =
  | "fire"
  | "flip"
  | "absorb"
  | "kill"
  | "discharge"
  | "inversion"
  | "hit"
  | "clear";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  // Called on the first user gesture.
  resume(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
  }

  play(cue: Cue): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    switch (cue) {
      case "fire":
        this.blip(880, 0.05, "square", 0.18, t);
        break;
      case "flip":
        this.sweep(420, 720, 0.09, "sawtooth", 0.2, t);
        break;
      case "absorb":
        this.blip(520, 0.08, "sine", 0.22, t);
        break;
      case "kill":
        this.blip(300, 0.09, "triangle", 0.24, t);
        this.blip(600, 0.06, "square", 0.14, t + 0.01);
        break;
      case "discharge":
        this.sweep(200, 1400, 0.5, "sawtooth", 0.3, t);
        break;
      case "inversion":
        this.sweep(900, 160, 0.6, "sine", 0.3, t);
        break;
      case "hit":
        this.sweep(400, 60, 0.4, "sawtooth", 0.35, t);
        break;
      case "clear":
        this.blip(523, 0.12, "triangle", 0.26, t);
        this.blip(659, 0.12, "triangle", 0.26, t + 0.12);
        this.blip(784, 0.16, "triangle", 0.26, t + 0.24);
        break;
    }
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    at: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private sweep(
    from: number,
    to: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    at: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}
