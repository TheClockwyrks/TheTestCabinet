// Locomotivation — the produced audio, played via Web Audio (specs/assets.md).
//
// Every sound is produced during the run with sfx-synth / sfx-sample / music and loaded as
// an ArrayBuffer (see assets.ts), decoded lazily here on the first user gesture. Audio must
// NOT autostart before that gesture, and the M mute toggle silences everything. The horn
// and the rising rumble are real telegraph cues (specs/trains.md); the rumble and the music
// bed loop. A missing/undecodable clip is non-fatal — that cue is simply silent, so the
// build runs before the audio assets land (the tolerance rule, specs/assets.md).

/** One-shot sound cues. */
export type Cue =
  | "footstep"
  | "pickup"
  | "delivery"
  | "horn"
  | "impact" // squish / cargo crunch
  | "confirm"
  | "alarm" // low-clock
  | "whistle"; // last-train departure

/** Looping cues (started/stopped and gain-modulated over time). */
export type LoopCue = "rumble" | "music";

type Name = Cue | LoopCue;

const MASTER_VOLUME = 0.7;
const ONE_SHOT_GAIN: Partial<Record<Cue, number>> = {
  footstep: 0.28,
  pickup: 0.6,
  delivery: 0.7,
  horn: 0.7,
  impact: 0.85,
  confirm: 0.7,
  alarm: 0.6,
  whistle: 0.8,
};

/**
 * Wraps a Web Audio graph over the produced buffers. Constructed with the raw encoded audio
 * from `loadAssets`; `resume()` must be called from a user-gesture handler before anything
 * plays. Loops are reconciled through a wanted-set so callers just declare intent.
 */
export class AudioEngine {
  private readonly encoded: Record<string, ArrayBuffer>;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<Name, AudioBuffer>();
  private readonly loops = new Map<LoopCue, { src: AudioBufferSourceNode; gain: GainNode }>();
  private readonly wantLoops = new Set<LoopCue>();
  private readonly loopTargetGain = new Map<LoopCue, number>();
  private readonly lastPlay = new Map<Cue, number>();
  private started = false;
  private muted = false;

  constructor(encoded: Record<string, ArrayBuffer>) {
    this.encoded = encoded;
  }

  /** Create/resume the AudioContext and decode the clips — call from the first user gesture. */
  async resume(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.syncLoops();
      return;
    }
    const AC =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(this.ctx.destination);

    await Promise.all(
      Object.entries(this.encoded).map(async ([name, raw]) => {
        try {
          // decodeAudioData consumes the buffer; copy so a re-decode never fails.
          const buf = await this.ctx!.decodeAudioData(raw.slice(0));
          this.buffers.set(name as Name, buf);
        } catch {
          // Non-fatal: that cue stays silent.
        }
      }),
    );
    this.started = true;
    this.syncLoops();
  }

  /** Play a one-shot cue (no-op while muted or before resume). */
  play(cue: Cue, volume = 1): void {
    if (!this.ctx || !this.master || this.muted || !this.started) return;
    const buf = this.buffers.get(cue);
    if (!buf) return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(cue) ?? -1;
    if (now - last < 0.035) return; // debounce a flood in one instant
    this.lastPlay.set(cue, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = (ONE_SHOT_GAIN[cue] ?? 0.7) * volume;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** Start a looping cue (rumble/music). Reconciled immediately. */
  startLoop(cue: LoopCue): void {
    this.wantLoops.add(cue);
    this.syncLoops();
  }

  /** Set a looping cue's target gain 0..1 (e.g. rumble rising with train proximity). */
  setLoopGain(cue: LoopCue, gain: number): void {
    const g = Math.max(0, Math.min(1, gain));
    this.loopTargetGain.set(cue, g);
    const node = this.loops.get(cue);
    if (node && this.ctx) node.gain.gain.setTargetAtTime(this.loopBaseGain(cue) * g, this.ctx.currentTime, 0.08);
  }

  /** Stop a looping cue. */
  stopLoop(cue: LoopCue): void {
    this.wantLoops.delete(cue);
    this.syncLoops();
  }

  private loopBaseGain(cue: LoopCue): number {
    return cue === "music" ? 0.34 : 0.5;
  }

  /** Start/stop looping sources to match the wanted set. Safe to call every frame. */
  private syncLoops(): void {
    if (!this.ctx || !this.master || !this.started) return;
    for (const [cue, node] of this.loops) {
      if (!this.wantLoops.has(cue)) {
        try {
          node.src.stop();
        } catch {
          /* already stopped */
        }
        this.loops.delete(cue);
      }
    }
    for (const cue of this.wantLoops) {
      if (this.loops.has(cue)) continue;
      const buf = this.buffers.get(cue);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      const target = this.loopTargetGain.get(cue) ?? (cue === "music" ? 1 : 0);
      gain.gain.value = this.loopBaseGain(cue) * target;
      src.connect(gain).connect(this.master);
      src.start();
      this.loops.set(cue, { src, gain });
    }
  }

  /** Toggle mute (M). Returns the new muted state. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }
}
