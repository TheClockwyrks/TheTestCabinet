// Facet — the audio bus: produced sounds, played by name over Web Audio.
//
// Every sound Facet makes is a `.wav` produced by `sfx-synth`, `sfx-sample`, or
// `music` and committed under `public/assets/audio/` (specs/assets.md). Nothing
// here oscillates anything: the bus takes the undecoded bytes the asset store
// fetched, decodes them once through `decodeAudioData`, and plays the resulting
// buffers.
//
// A cue is DECLARED once under a name and then PLAYED BY NAME as events happen,
// which is what keeps the sound legible from outside the game: a mistyped name
// throws at the moment of the event rather than going quietly silent. A cue may
// name several LAYERS, played together — which is exactly what `clear` is, the
// shatter body under a rung of the chain ladder — and may name a LADDER, an
// ordered list the play picks one entry from by the variant it is given. The
// rungs are that one cue's sources rather than cues of their own (specs/ui.md).
//
// Three rules the rest of the build leans on:
//
//   * Nothing about audio may fail a frame. A browser with no Web Audio, a
//     context that never unlocked, bytes that have not arrived, a context that
//     died mid-frame — each degrades to silence, never to a thrown frame.
//   * Muting is a gain of zero on the master, not a skipped cue. The bus does
//     the same work either way, so a muted game and a loud one behave
//     identically apart from what comes out of the speakers.
//   * The context is not created until the first user gesture. One created
//     outside a gesture starts suspended, and some browsers count the attempt
//     against the page.

/** One named cue: the sources it plays and how loud. */
export interface CueSpec {
  /** Sample keys played together on every play of the cue. */
  readonly layers: readonly string[];
  /**
   * An ordered list of sample keys the cue picks one of, by the `variant`
   * passed to {@link AudioBus.play}. The chain ladder is the only one.
   */
  readonly ladder?: readonly string[];
  /** Peak gain in `[0, 1]`; defaults to {@link DEFAULT_CUE_GAIN}. */
  readonly gain?: number;
}

/** How the bus obtains a Web Audio context, or `null` where there is none. */
export type AudioContextSource = () => AudioContext | null;

/** Where the bus reads a sound's undecoded bytes, or `null` until they land. */
export type SampleSource = (key: string) => ArrayBuffer | null;

/** The gain a cue plays at when its spec names none. */
export const DEFAULT_CUE_GAIN = 0.55;

/** The gain the music beds play at, under the cues rather than over them. */
export const MUSIC_GAIN = 0.34;

/** The gestures that count as the player asking for sound. */
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/** The platform's own `AudioContext`, or `null` where the platform has none. */
export function platformAudioContext(): AudioContext | null {
  if (typeof globalThis.AudioContext !== "function") return null;
  try {
    return new globalThis.AudioContext();
  } catch {
    return null;
  }
}

export class AudioBus {
  private readonly cues = new Map<string, CueSpec>();
  private readonly source: AudioContextSource;
  private readonly samples: SampleSource;
  private readonly decoded = new Map<string, AudioBuffer>();
  /** Keys a `decodeAudioData` is already in flight for, so none is decoded twice. */
  private readonly decoding = new Set<string>();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private mutedFlag = false;
  private disarm: (() => void) | null = null;
  /** The bed the game asks for, and the source actually sounding it. */
  private wantedTrack: string | null = null;
  private track: { key: string; node: AudioBufferSourceNode } | null = null;

  constructor(
    samples: SampleSource,
    source: AudioContextSource = platformAudioContext,
  ) {
    this.samples = samples;
    this.source = source;
  }

  /** Declare a cue under a name; redeclaring replaces it. */
  define(cue: string, spec: CueSpec): void {
    this.cues.set(cue, { ...spec });
  }

  /**
   * Play a declared cue, at the ladder rung `variant` names when it has a
   * ladder. `variant` counts from `1` and is clamped to the ladder's length,
   * which is what makes a chain that has capped its multiplier hold on the
   * highest rung.
   *
   * Playing a cue that was never declared throws, because silence is the
   * expected outcome of a muted bus and the typo would otherwise be
   * indistinguishable from an inaudible cue.
   */
  play(cue: string, variant = 1): void {
    const spec = this.cues.get(cue);
    if (spec === undefined) {
      throw new Error(`Facet: cue "${cue}" was played but never defined.`);
    }
    const gain = spec.gain ?? DEFAULT_CUE_GAIN;
    for (const key of spec.layers) this.sound(key, gain);
    if (spec.ladder && spec.ladder.length > 0) {
      const rung = Math.min(
        Math.max(Math.floor(variant), 1),
        spec.ladder.length,
      );
      this.sound(spec.ladder[rung - 1], gain);
    }
  }

  /**
   * Ask for a looping music bed, by sample key, or for silence with `null`.
   *
   * Called every frame by the game, so the bed follows the screen without the
   * game tracking what is already playing: the same key twice running is a
   * no-op, and a key whose bytes have not decoded yet is remembered and
   * started the moment they have.
   */
  setTrack(key: string | null): void {
    this.wantedTrack = key;
    this.syncTrack();
  }

  /** The bed currently sounding, or `null`. */
  playing(): string | null {
    return this.track?.key ?? null;
  }

  /** Mute or unmute the bus, which silences the cues and the bed together. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  /** Whether the bus is muted. */
  muted(): boolean {
    return this.mutedFlag;
  }

  /** Whether a gesture has opened the audio context. */
  unlocked(): boolean {
    return this.context !== null;
  }

  /**
   * Decode every sound whose bytes have arrived and are not decoded yet.
   *
   * Called on the unlock and again each frame the asset load reports more
   * files in, so the set of playable sounds catches up with the set of fetched
   * ones without anything having to sequence the two.
   */
  prime(keys: readonly string[]): void {
    if (this.context === null) return;
    for (const key of keys) this.decode(key);
    this.syncTrack();
  }

  /**
   * Open the context on the first user gesture on `target`.
   *
   * A target that never sees a gesture — a test driving the bus in process —
   * simply stays locked, which is silent and correct.
   */
  armUnlock(target: EventTarget): void {
    if (this.disarm !== null || this.context !== null) return;
    const unlock = (): void => {
      this.open();
      this.disarm?.();
    };
    for (const type of UNLOCK_EVENTS) target.addEventListener(type, unlock);
    this.disarm = () => {
      this.disarm = null;
      for (const type of UNLOCK_EVENTS)
        target.removeEventListener(type, unlock);
    };
  }

  /** Drop the gesture listeners and close the context. Idempotent. */
  dispose(): void {
    this.disarm?.();
    this.stopTrack();
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
    try {
      const master = context.createGain();
      master.gain.value = this.mutedFlag ? 0 : 1;
      master.connect(context.destination);
      this.master = master;
    } catch {
      this.master = null;
    }
    void context.resume().catch(() => undefined);
  }

  /** The decoded buffer for `key`, decoding it now if it can be. */
  private buffer(key: string): AudioBuffer | null {
    const ready = this.decoded.get(key);
    if (ready) return ready;
    this.decode(key);
    return null;
  }

  /**
   * Decode one sound, once.
   *
   * The bytes are COPIED before they are handed over: `decodeAudioData`
   * detaches the buffer it is given, and the asset store's copy has to survive
   * for a second decode after a context is reopened.
   */
  private decode(key: string): void {
    const context = this.context;
    if (context === null) return;
    if (this.decoded.has(key) || this.decoding.has(key)) return;
    const bytes = this.samples(key);
    if (bytes === null) return;
    this.decoding.add(key);
    void context
      .decodeAudioData(bytes.slice(0))
      .then((buffer) => {
        this.decoded.set(key, buffer);
        this.syncTrack();
      })
      .catch(() => undefined)
      .finally(() => {
        this.decoding.delete(key);
      });
  }

  /** One buffer through one gain, straight at the master. Never throws. */
  private sound(key: string, gain: number): void {
    const context = this.context;
    const master = this.master;
    const buffer = this.buffer(key);
    if (context === null || master === null || buffer === null) return;
    try {
      const node = context.createBufferSource();
      const level = context.createGain();
      node.buffer = buffer;
      level.gain.value = gain;
      node.connect(level).connect(master);
      node.start();
    } catch {
      // A context that died mid-frame degrades to silence, never to a thrown
      // frame.
    }
  }

  /** Start, stop, or swap the bed so that what sounds is what was asked for. */
  private syncTrack(): void {
    if (this.track && this.track.key === this.wantedTrack) return;
    this.stopTrack();
    if (this.wantedTrack === null) return;
    const context = this.context;
    const master = this.master;
    const buffer = this.buffer(this.wantedTrack);
    if (context === null || master === null || buffer === null) return;
    try {
      const node = context.createBufferSource();
      const level = context.createGain();
      node.buffer = buffer;
      node.loop = true;
      level.gain.value = MUSIC_GAIN;
      node.connect(level).connect(master);
      node.start();
      this.track = { key: this.wantedTrack, node };
    } catch {
      this.track = null;
    }
  }

  /** Stop whatever bed is sounding. */
  private stopTrack(): void {
    const current = this.track;
    this.track = null;
    if (current === null) return;
    try {
      current.node.stop();
      current.node.disconnect();
    } catch {
      // Already stopped, or the context has gone; either way it is silent.
    }
  }
}
