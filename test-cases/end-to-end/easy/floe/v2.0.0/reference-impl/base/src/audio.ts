// Floe — synthesized audio (Web Audio API; no audio files). Optional and mutable;
// never required for the game to run. Nothing is created until the first user
// gesture resumes the context (browsers block autoplay). See specs/ui.md.

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

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
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

  hop(): void {
    this.blip(440, 0.07, "square", 0.08, 620);
  }
  splash(): void {
    this.blip(260, 0.28, "sawtooth", 0.12, 90);
  }
  crush(): void {
    this.blip(150, 0.3, "square", 0.16, 60);
  }
  caught(): void {
    this.blip(200, 0.4, "sawtooth", 0.18, 70);
    this.blip(120, 0.42, "square", 0.12, 50);
  }
  bay(): void {
    this.blip(660, 0.1, "triangle", 0.14, 990);
  }
  bonusLife(): void {
    this.arpeggio([784, 1047, 1319], 0.08, "triangle", 0.15);
  }
  levelClear(): void {
    this.arpeggio([523, 659, 784, 1047], 0.09, "triangle");
  }
  victory(): void {
    this.arpeggio([523, 659, 784, 1047, 1319], 0.13, "triangle", 0.16);
  }
  gameOver(): void {
    this.arpeggio([392, 330, 262, 196], 0.16, "sawtooth", 0.14);
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
}
