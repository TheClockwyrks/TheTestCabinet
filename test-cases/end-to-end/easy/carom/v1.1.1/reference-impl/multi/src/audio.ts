// Carom — optional synthesized audio (Web Audio API, no audio files).
//
// Distinct short blips for a paddle hit, a wall/obstacle bounce, and a scored
// point. Audio is never required for the game to run: if the AudioContext is
// unavailable or muted, every call is a no-op. Nothing plays until the first
// user gesture resumes the context (see Input.onFirstPress).

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
  }

  private blip(
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
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, slideTo),
        now + dur,
      );
    }
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  paddleHit(): void {
    this.blip(430, 0.07, "square", 0.22, 620);
  }
  bounce(): void {
    this.blip(240, 0.05, "sine", 0.16);
  }
  score(): void {
    // A rising two-tone chime, both notes scheduled on the audio clock.
    this.blip(320, 0.09, "triangle", 0.2, 480, 0);
    this.blip(520, 0.12, "triangle", 0.18, 660, 0.09);
  }
}
