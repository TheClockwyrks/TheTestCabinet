// Wick — the Web Audio layer (specs/ui.md "Audio", specs/assets.md "The
// sound").
//
// Fifteen produced cues, each decoded once from the file `specs/assets.md`
// names for it. A one-shot cue plays on its event through a buffer source;
// the two looping cues each sound through a single source set to loop, from
// the frame that starts it until the frame that stops it. Muting drives the
// master gain to silence without stopping a loop, so the loop returns in
// place when unmuted.
//
// Browsers refuse to start audio before the player has interacted with the
// page, so the context is resumed by `unlock()` on the first gesture. Every
// step is guarded: a context that cannot be created, a file that will not
// fetch, and a clip that will not decode each leave the game playable and
// simply silent.

import { CUE_NAMES, LOOPING_CUES, type Cue } from "./constants";

const CUE_GAIN = 0.9;
const LOOP_GAIN = 0.5;

export class WebAudioBus {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private cueBus: GainNode | null = null;
  private loopBus: GainNode | null = null;
  private readonly buffers = new Map<Cue, AudioBuffer>();
  /** The looping sources running, by cue. */
  private readonly loops = new Map<Cue, AudioBufferSourceNode>();
  /** The loops asked for, retried each sync until their buffers decode. */
  private wanted = new Set<Cue>();
  private mutedBit = false;

  /** Build the graph and decode every produced sound whose URL is known. */
  async load(urls: ReadonlyMap<Cue, string>): Promise<void> {
    try {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = this.mutedBit ? 0 : 1;
      master.connect(context.destination);
      const cueBus = context.createGain();
      cueBus.gain.value = CUE_GAIN;
      cueBus.connect(master);
      const loopBus = context.createGain();
      loopBus.gain.value = LOOP_GAIN;
      loopBus.connect(master);
      this.context = context;
      this.master = master;
      this.cueBus = cueBus;
      this.loopBus = loopBus;
    } catch {
      return;
    }
    await Promise.all(
      CUE_NAMES.map((cue) => this.decode(cue, urls.get(cue) ?? null)),
    );
    this.syncLoops(this.wanted);
  }

  /** Resume the context on the first user gesture, which browsers wait for. */
  unlock(): void {
    if (this.context && this.context.state === "suspended") {
      void this.context.resume().catch(() => undefined);
    }
  }

  /** The mute bit. Silences everything without stopping a loop. */
  get muted(): boolean {
    return this.mutedBit;
  }

  set muted(muted: boolean) {
    this.mutedBit = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  /** Play one one-shot cue now. */
  play(cue: Cue): void {
    if (LOOPING_CUES.includes(cue)) return;
    const context = this.context;
    const bus = this.cueBus;
    const buffer = this.buffers.get(cue);
    if (!context || !bus || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(bus);
    source.start();
  }

  /** The looping cues sounding right now. */
  looping(): Cue[] {
    return [...this.loops.keys()];
  }

  /**
   * Keep exactly the cues in `wanted` looping. Idempotent and called every
   * frame, so a loop whose clip had not decoded when it was first wanted
   * starts on the first frame it is ready, and starting one that is already
   * looping changes nothing.
   */
  syncLoops(wanted: ReadonlySet<Cue>): void {
    this.wanted = new Set(wanted);
    for (const [cue, source] of this.loops) {
      if (wanted.has(cue)) continue;
      try {
        source.stop();
      } catch {
        // A source that never started needs no stopping.
      }
      this.loops.delete(cue);
    }
    for (const cue of wanted) {
      if (this.loops.has(cue)) continue;
      const context = this.context;
      const bus = this.loopBus;
      const buffer = this.buffers.get(cue);
      if (!context || !bus || !buffer) continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(bus);
      source.start();
      this.loops.set(cue, source);
    }
  }

  private async decode(cue: Cue, url: string | null): Promise<void> {
    if (!this.context || url === null) return;
    try {
      const response = await fetch(url);
      const encoded = await response.arrayBuffer();
      this.buffers.set(cue, await this.context.decodeAudioData(encoded));
    } catch {
      // A sound whose file will not load or decode is simply silent.
    }
  }
}
