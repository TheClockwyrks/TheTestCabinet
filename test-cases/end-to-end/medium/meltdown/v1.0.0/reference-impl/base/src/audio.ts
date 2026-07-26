// Meltdown — synthesized audio (Web Audio API; no audio files). Optional and
// mutable; never required for the game to run. Nothing is created until the
// first user gesture resumes the context (browsers block autoplay). Muting is
// owned by Game (`muted`, toggled by the KeyM accelerator, specs/controls.md);
// `setMuted` mirrors it here so a muted run schedules nothing. See specs/ui.md.

type Voice = "square" | "sine" | "triangle" | "sawtooth";

export class Audio {
  private ctx: AudioContext | null = null;
  private muted = false;

  resume(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  private blip(
    freq: number,
    dur: number,
    type: Voice,
    gain = 0.14,
    slideTo?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, slideTo),
        now + dur,
      );
    }
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private arpeggio(
    freqs: number[],
    step: number,
    type: Voice,
    gain = 0.13,
  ): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    freqs.forEach((f, i) => {
      const now = ctx.currentTime + i * step;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, now);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + step * 1.4);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + step * 1.5);
    });
  }

  // An emitter firing (specs/ui.md): a short, sharp zap.
  fire(): void {
    this.blip(760, 0.05, "square", 0.08, 420);
  }
  // A tower tripping offline at its redline: a harsh, falling buzz.
  trip(): void {
    this.blip(220, 0.35, "sawtooth", 0.17, 70);
  }
  // A unit leaking an exhaust: a descending, breathy warning.
  leak(): void {
    this.blip(320, 0.3, "triangle", 0.15, 120);
  }
  // A surge unit dying: a short, dull thud.
  death(): void {
    this.blip(160, 0.12, "square", 0.16, 90);
  }
  // Placing a tower: a bright, brief confirm click.
  place(): void {
    this.blip(520, 0.07, "triangle", 0.11, 720);
  }
  // Clearing a wave: a short rising flourish.
  waveClear(): void {
    this.arpeggio([523, 659, 784], 0.08, "triangle");
  }
  // The Victory sting: a bright, full rising run.
  victory(): void {
    this.arpeggio([523, 659, 784, 1047, 1319], 0.13, "triangle", 0.16);
  }
  // The Game-over sting: a falling, sour run.
  gameOver(): void {
    this.arpeggio([392, 330, 262, 196], 0.16, "sawtooth", 0.14);
  }
}
