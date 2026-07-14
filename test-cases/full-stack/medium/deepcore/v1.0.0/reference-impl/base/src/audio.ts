// Deepcore — audio playback via Web Audio (specs/assets.md "Audio").
//
// Plays the PRODUCED .wav cues on their events and loops the lonely descent bed and the
// two alarms (low-fuel, core-timer) while their conditions hold. Nothing autostarts
// before the first user gesture (browsers block autoplay); a mute toggle silences all
// audio (specs/controls.md). A missing/undecodable clip is non-fatal — that cue is
// simply silent, so the game runs before the audio assets land.

export type Cue =
  | "ore-pickup"
  | "material-chime"
  | "gas-explosion"
  | "lava-sizzle"
  | "impact"
  | "fabricate"
  | "launch"
  | "death";

/** Cues that play as a sustained loop while active (started/stopped by the game). */
export type LoopCue = "drill" | "thrust" | "alarm-fuel" | "alarm-core" | "music";

type Name = Cue | LoopCue;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<Name, AudioBuffer>();
  private loops = new Map<LoopCue, { src: AudioBufferSourceNode; gain: GainNode }>();
  private started = false;
  private lastPlay = new Map<Cue, number>();
  private wantLoops = new Set<LoopCue>();
  muted = false;

  constructor(private readonly urls: Record<Name, string>) {}

  /** First user gesture: build the graph, decode the clips, and (re)start wanted loops. */
  async resume(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.syncLoops();
      return;
    }
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);

    await Promise.all(
      (Object.keys(this.urls) as Name[]).map(async (name) => {
        const url = this.urls[name];
        if (!url) return;
        try {
          const res = await fetch(url);
          const raw = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(raw);
          this.buffers.set(name, buf);
        } catch {
          // Non-fatal: that cue is silent.
        }
      }),
    );
    this.started = true;
    this.wantLoops.add("music");
    this.syncLoops();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.02);
    }
  }

  /** Mark a loop wanted/unwanted; the graph is reconciled once per frame via `syncLoops`. */
  setLoop(cue: LoopCue, active: boolean): void {
    if (active) this.wantLoops.add(cue);
    else this.wantLoops.delete(cue);
  }

  /** Start/stop looping sources to match the wanted set. Call once per frame. */
  syncLoops(): void {
    if (!this.ctx || !this.master || !this.started) return;
    // Stop loops no longer wanted.
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
    // Start newly wanted loops.
    for (const cue of this.wantLoops) {
      if (this.loops.has(cue)) continue;
      const buf = this.buffers.get(cue);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = cue === "music" ? 0.34 : 0.5;
      src.connect(gain).connect(this.master);
      src.start();
      this.loops.set(cue, { src, gain });
    }
  }

  /** Fire a one-shot cue (debounced so a flood in one instant does not stack). */
  play(cue: Cue): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buf = this.buffers.get(cue);
    if (!buf) return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(cue) ?? -1;
    if (now - last < 0.04) return;
    this.lastPlay.set(cue, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.8;
    src.connect(g).connect(this.master);
    src.start();
  }
}
