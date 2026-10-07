// Orrery — the audio bus (specs/ui.md "Audio", specs/assets.md "The sound").
//
// The game stands on no engine, so the cue bus is this build's. It plays the
// seven produced sounds specs/assets.md names, decoded once with the Web Audio
// API: six one-shot cues fired on their events, and the music bed, which loops
// from the first frame on every screen.
//
// Muting is the runtime's, and it is one bit over the whole graph — the master
// gain — so a muted game still schedules every cue and is still fully
// playable, and unmuting is immediate rather than waiting for the next event.
// The game binds the `mute` action to `setMuted` and mirrors `muted()` into
// `state.muted` every frame (specs/ui.md).
//
// Browsers refuse to start audio before the player has interacted with the
// page, so the context is resumed by `unlock()` on the first gesture. Every
// step is guarded: a context that cannot be created, a file that will not
// fetch, and a clip that will not decode each leave the game fully playable
// and simply silent, which is the bar specs/assets.md sets for a load that
// fails.

import { CUES, LOOPING_CUES, type Cue } from "./constants";

/** How loud a one-shot cue sits. */
const CUE_GAIN = 0.9;
/** How loud the bed sits: under the cues, as specs/assets.md asks. */
const BED_GAIN = 0.5;

/** The Web Audio pieces this bus needs, named structurally so a test can stand in. */
interface Graph {
  context: AudioContext;
  master: GainNode;
  cueBus: GainNode;
  bedBus: GainNode;
}

export class AudioBus {
  private graph: Graph | null = null;
  private readonly buffers = new Map<Cue, AudioBuffer>();
  /** The looping cue asked for; retried until its buffer has decoded. */
  private wantedBed: Cue | null = null;
  private runningBed: { cue: Cue; source: AudioBufferSourceNode } | null = null;
  private mutedBit = false;

  /** Build the graph and decode every produced sound. Called once, at load. */
  async load(urls: Partial<Record<Cue, string | null>>): Promise<void> {
    if (this.graph === null) {
      try {
        const context = new AudioContext();
        const master = context.createGain();
        master.gain.value = this.mutedBit ? 0 : 1;
        master.connect(context.destination);
        const cueBus = context.createGain();
        cueBus.gain.value = CUE_GAIN;
        cueBus.connect(master);
        const bedBus = context.createGain();
        bedBus.gain.value = BED_GAIN;
        bedBus.connect(master);
        this.graph = { context, master, cueBus, bedBus };
      } catch {
        return;
      }
    }
    await Promise.all(
      Object.entries(urls).map(([cue, url]) =>
        this.decode(cue as Cue, url ?? null),
      ),
    );
    // A bed asked for before its clip decoded starts on the first frame it can.
    this.syncBed(this.wantedBed);
  }

  /** Resume the context on the first user gesture, which browsers wait for. */
  unlock(): void {
    const context = this.graph?.context;
    if (context !== undefined && context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
  }

  /** Whether the game is muted. Mirrored into `state.muted` every frame. */
  muted(): boolean {
    return this.mutedBit;
  }

  /** Set the mute bit, over the whole graph at once. */
  setMuted(muted: boolean): void {
    this.mutedBit = muted;
    if (this.graph !== null) this.graph.master.gain.value = muted ? 0 : 1;
  }

  /** Toggle the mute bit, which is what the `mute` action does. */
  toggleMuted(): void {
    this.setMuted(!this.mutedBit);
  }

  /** Play one one-shot cue now. A looping cue is started with `loop`. */
  play(cue: Cue): void {
    if ((LOOPING_CUES as readonly Cue[]).includes(cue)) {
      this.syncBed(cue);
      return;
    }
    const graph = this.graph;
    const buffer = this.buffers.get(cue);
    if (graph === null || buffer === undefined) return;
    const source = graph.context.createBufferSource();
    source.buffer = buffer;
    source.connect(graph.cueBus);
    source.start();
  }

  /**
   * Keep exactly one looping cue running — or nothing, for `null`. Idempotent
   * and called every frame, so the bed of specs/ui.md runs on every screen from
   * the first frame it can.
   */
  syncBed(cue: Cue | null): void {
    this.wantedBed = cue;
    if (this.runningBed !== null && this.runningBed.cue === cue) return;
    if (this.runningBed !== null) {
      try {
        this.runningBed.source.stop();
      } catch {
        // A source that never started needs no stopping.
      }
      this.runningBed = null;
    }
    if (cue === null) return;
    const graph = this.graph;
    const buffer = this.buffers.get(cue);
    if (graph === null || buffer === undefined) return;
    const source = graph.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(graph.bedBus);
    source.start();
    this.runningBed = { cue, source };
  }

  /** Start the music bed, which loops until stopped (specs/ui.md). */
  loopMusic(): void {
    this.syncBed(CUES.music);
  }

  private async decode(cue: Cue, url: string | null): Promise<void> {
    const graph = this.graph;
    if (graph === null || url === null) return;
    try {
      const response = await fetch(url);
      const encoded = await response.arrayBuffer();
      this.buffers.set(cue, await graph.context.decodeAudioData(encoded));
    } catch {
      // A sound whose file will not load or decode is simply silent.
    }
  }
}
