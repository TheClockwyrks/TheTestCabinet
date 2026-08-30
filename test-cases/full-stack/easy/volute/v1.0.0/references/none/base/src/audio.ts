// Volute — the audio layer (specs/ui.md "Audio", specs/assets.md "The sound").
//
// Fifteen cues, each a produced `.wav`: thirteen one-shots played on their event
// and two beds that LOOP under the hall. Nothing here is synthesized — every sound
// the game makes traces to a file produced with `sfx-synth`, `sfx-sample` or
// `music`.
//
// Three rules the rest of the build leans on:
//
//   * Nothing about audio may fail a frame. A browser with no Web Audio, a context
//     that never unlocked, a decode that failed, a context that died mid-frame —
//     each degrades to silence, never to a thrown frame.
//   * Muting is a master gain of zero, not a skipped cue. A muted bed goes on
//     looping silently and returns in place when the mute is lifted.
//   * The context is not opened until the first user gesture. One opened outside a
//     gesture starts suspended, and some browsers count the attempt against the
//     page.

import { CUES } from "./constants";
import type { CueName } from "./constants";

/** How the bus obtains a Web Audio context, or `null` where there is none. */
export type AudioContextSource = () => AudioContext | null;

/** The gestures that count as the player asking for sound. */
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/** The gain a one-shot cue plays at. */
const CUE_GAIN = 0.7;
/** The gain a music bed loops at, under the cues rather than over them. */
const BED_GAIN = 0.45;

/** The platform's own `AudioContext`, or `null` where the platform has none. */
export function platformAudioContext(): AudioContext | null {
  if (typeof globalThis.AudioContext !== "function") return null;
  try {
    return new globalThis.AudioContext();
  } catch {
    return null;
  }
}

/** The named cues, their decoded buffers, and the two looping beds. */
export class AudioBus {
  private readonly source: AudioContextSource;
  private readonly bytes = new Map<CueName, ArrayBuffer>();
  private readonly buffers = new Map<CueName, AudioBuffer>();
  private readonly loops = new Map<CueName, AudioBufferSourceNode>();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private mutedFlag = false;
  private disarm: (() => void) | null = null;

  constructor(source: AudioContextSource = platformAudioContext) {
    this.source = source;
  }

  /**
   * Hand the bus the produced files, undecoded.
   *
   * Decoding needs a context and a context needs a gesture, so the bytes are held
   * until the unlock and decoded then.
   */
  load(files: Readonly<Record<CueName, ArrayBuffer | null>>): void {
    for (const cue of CUES) {
      const bytes = files[cue];
      if (bytes !== null && bytes !== undefined) this.bytes.set(cue, bytes);
    }
    if (this.context !== null) void this.decodeAll();
  }

  /** Open the context on the first user gesture on `target`. */
  armUnlock(target: EventTarget): void {
    if (this.disarm !== null || this.context !== null) return;
    const unlock = (): void => {
      this.open();
      this.disarm?.();
    };
    for (const type of UNLOCK_EVENTS) target.addEventListener(type, unlock);
    this.disarm = () => {
      this.disarm = null;
      for (const type of UNLOCK_EVENTS) {
        target.removeEventListener(type, unlock);
      }
    };
  }

  /** Whether a gesture has opened the audio context. */
  unlocked(): boolean {
    return this.context !== null;
  }

  /** Play a one-shot cue, once. */
  play(cue: CueName): void {
    const node = this.startSource(cue, false, CUE_GAIN);
    if (node !== null) node.start();
  }

  /**
   * Start a cue looping, end to end with no gap, until it is stopped.
   *
   * A cue is either looping or not, so starting one that is already looping
   * changes nothing.
   */
  loop(cue: CueName): void {
    if (this.loops.has(cue)) return;
    const node = this.startSource(cue, true, BED_GAIN);
    if (node === null) return;
    this.loops.set(cue, node);
    node.start();
  }

  /** Stop a looping cue. */
  stop(cue: CueName): void {
    const node = this.loops.get(cue);
    if (node === undefined) return;
    this.loops.delete(cue);
    try {
      node.stop();
      node.disconnect();
    } catch {
      // A node the context already tore down needs no stopping.
    }
  }

  /** Whether a cue is currently looping. */
  looping(cue: CueName): boolean {
    return this.loops.has(cue);
  }

  /** Mute or unmute the bus, leaving every running loop where it is. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    if (this.master !== null) this.master.gain.value = muted ? 0 : 1;
  }

  /** Whether the bus is muted. */
  muted(): boolean {
    return this.mutedFlag;
  }

  /** Drop the gesture listeners, stop every loop, and close the context. */
  dispose(): void {
    this.disarm?.();
    for (const cue of [...this.loops.keys()]) this.stop(cue);
    const context = this.context;
    this.context = null;
    this.master = null;
    void context?.close().catch(() => undefined);
  }

  /** Open the context, degrading to silence where the platform has none. */
  private open(): void {
    if (this.context !== null) return;
    const context = this.source();
    if (context === null) return;
    this.context = context;
    const master = context.createGain();
    master.gain.value = this.mutedFlag ? 0 : 1;
    master.connect(context.destination);
    this.master = master;
    void context.resume().catch(() => undefined);
    void this.decodeAll();
  }

  /** Decode every produced file the bus is holding. Never throws into a frame. */
  private async decodeAll(): Promise<void> {
    const context = this.context;
    if (context === null) return;
    await Promise.all(
      [...this.bytes.entries()].map(async ([cue, bytes]) => {
        if (this.buffers.has(cue)) return;
        try {
          // Sliced, because decoding detaches the buffer it is handed and the
          // bytes are kept for a context opened a second time.
          this.buffers.set(cue, await context.decodeAudioData(bytes.slice(0)));
        } catch {
          // A cue that will not decode is silent; the rest of the set still plays.
        }
      }),
    );
  }

  /** A source node wired to the master gain, or `null` if nothing can sound. */
  private startSource(
    cue: CueName,
    looping: boolean,
    gain: number,
  ): AudioBufferSourceNode | null {
    const context = this.context;
    const master = this.master;
    const buffer = this.buffers.get(cue);
    if (context === null || master === null || buffer === undefined)
      return null;
    try {
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.loop = looping;
      const level = context.createGain();
      level.gain.value = gain;
      node.connect(level).connect(master);
      return node;
    } catch {
      return null;
    }
  }
}
