// Kessler — the Web Audio layer (specs/assets.md "The sound").
//
// Thirteen produced cues and two produced music beds, each decoded once with
// the Web Audio API from the file `specs/assets.md` names for it. A cue plays
// on its event through the cue gain; the beds run through looping sources on
// the bed gain, one bed per screen: the title bed on `title` and `howto`, the
// play bed on `playing`, `waveclear`, and `paused`, and no bed on `gameover`,
// so the `game-over` cue rings out over silence. Each bed sits under the
// cues rather than competing with them.
//
// Browsers refuse to start audio before the player has interacted with the
// page, so the context is resumed by `unlock()` on the first gesture. Every
// step is guarded: a context that cannot be created, a file that will not
// fetch, and a clip that will not decode each leave the game fully playable
// and simply silent.

import { BEDS, type Assets, type Bed } from "./assets";
import { CUES, type Cue, type ScreenName } from "./constants";

const CUE_GAIN = 0.9;
const BED_GAIN = 0.55;

/** The bed `screen` runs, or `null` for the screen that plays none. */
export function bedForScreen(screen: ScreenName): Bed | null {
  switch (screen) {
    case "title":
    case "howto":
      return "music-title";
    case "playing":
    case "waveclear":
    case "paused":
      return "music-play";
    case "gameover":
      return null;
  }
}

export class WebAudioBus {
  private context: AudioContext | null = null;
  private cueBus: GainNode | null = null;
  private bedBus: GainNode | null = null;
  private readonly buffers = new Map<Cue | Bed, AudioBuffer>();
  /** The bed asked for; retried each sync until its buffer has decoded. */
  private wanted: Bed | null = null;
  /** The looping source actually running, and the bed it plays. */
  private running: { bed: Bed; source: AudioBufferSourceNode } | null = null;

  /** Build the graph and decode every produced sound. Called once, at load. */
  async load(assets: Assets): Promise<void> {
    try {
      const context = new AudioContext();
      const cueBus = context.createGain();
      cueBus.gain.value = CUE_GAIN;
      cueBus.connect(context.destination);
      const bedBus = context.createGain();
      bedBus.gain.value = BED_GAIN;
      bedBus.connect(context.destination);
      this.context = context;
      this.cueBus = cueBus;
      this.bedBus = bedBus;
    } catch {
      return;
    }
    await Promise.all(
      [...CUES, ...BEDS].map((name) => this.decode(name, assets.audio[name])),
    );
    this.syncBed(this.wanted);
  }

  /** Resume the context on the first user gesture, which browsers wait for. */
  unlock(): void {
    if (this.context && this.context.state === "suspended") {
      void this.context.resume().catch(() => undefined);
    }
  }

  /** Play one cue now. */
  play(cue: Cue): void {
    const context = this.context;
    const cueBus = this.cueBus;
    const buffer = this.buffers.get(cue);
    if (!context || !cueBus || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(cueBus);
    source.start();
  }

  /**
   * Keep exactly `bed` looping — or nothing, for `null`. Idempotent and
   * called every frame, so a bed whose clip had not decoded when the screen
   * arrived starts on the first frame it is ready.
   */
  syncBed(bed: Bed | null): void {
    this.wanted = bed;
    if (this.running !== null && this.running.bed === bed) return;
    if (this.running !== null) {
      try {
        this.running.source.stop();
      } catch {
        // A source that never started needs no stopping.
      }
      this.running = null;
    }
    if (bed === null) return;
    const context = this.context;
    const bedBus = this.bedBus;
    const buffer = this.buffers.get(bed);
    if (!context || !bedBus || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(bedBus);
    source.start();
    this.running = { bed, source };
  }

  private async decode(name: Cue | Bed, url: string | null): Promise<void> {
    if (!this.context || url === null) return;
    try {
      const response = await fetch(url);
      const encoded = await response.arrayBuffer();
      this.buffers.set(name, await this.context.decodeAudioData(encoded));
    } catch {
      // A sound whose file will not load or decode is simply silent.
    }
  }
}
