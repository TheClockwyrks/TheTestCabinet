// Fathom — optional synthesized audio (Web Audio API, no audio files).
// Short cues only; never required for the game to run. Not started until the
// first player interaction (browsers block autoplay); muteable.

type Cue =
  | "eat"
  | "sonar"
  | "ink"
  | "predPulse"
  | "flare"
  | "alert"
  | "caught"
  | "descend";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return !!this.ctx;
  }

  // Call from a user-gesture handler so the context can start.
  resume(): void {
    if (this.ensure() && this.ctx!.state === "suspended") void this.ctx!.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    freq2?: number,
    gain = 1,
  ): void {
    if (this.muted || !this.ensure()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freq2 !== undefined) osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, freq2),
      t + dur,
    );
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  play(cue: Cue): void {
    switch (cue) {
      case "eat":
        this.blip(520, 0.06, "square", 720, 0.6);
        break;
      case "sonar":
        this.blip(880, 0.4, "sine", 300, 0.7);
        break;
      case "ink":
        this.blip(200, 0.35, "sawtooth", 60, 0.6);
        break;
      case "predPulse":
        this.blip(420, 0.35, "sine", 180, 0.35);
        break;
      case "flare":
        this.blip(260, 0.5, "triangle", 620, 0.5);
        break;
      case "alert":
        // A sharp, rising sting — you have been detected.
        this.blip(700, 0.22, "square", 1200, 0.7);
        break;
      case "caught":
        this.blip(300, 0.6, "sawtooth", 50, 0.9);
        break;
      case "descend":
        this.blip(180, 0.7, "sine", 520, 0.7);
        break;
    }
  }
}
