// Meltdown — the audio bus: named cues, synthesized on the spot.
//
// The build ships no audio file and loads none (specs/audio.md), so every sound
// is one oscillator through one gain envelope. A cue is DECLARED once under a
// name and then PLAYED BY NAME as events happen, which is what keeps the sound
// legible from outside the game: a mistyped name throws at the moment of the
// event rather than going quietly silent.
//
// Two rules the rest of the build leans on:
//
//   * Nothing about audio may fail a frame. A browser with no Web Audio, a
//     context that never unlocked, a context that died mid-frame — each degrades
//     to silence, never to a thrown frame.
//   * Muting emits nothing at all. While muted the bus starts no source, which is
//     what "mute silences everything" means from outside the page as well as
//     inside it, and the game stays fully playable either way.
//
// The context is not created until the first user gesture, because browsers block
// audio until the page has been interacted with and the game must start and run
// correctly whether or not audio can start.

/** The synthesis behind a named cue: small on purpose. */
export interface CueSpec {
  /** The oscillator waveform; defaults to a sine. */
  wave?: OscillatorType;
  /** The starting frequency, in hertz. */
  freq: number;
  /** The frequency to sweep to over the cue's duration; absent holds `freq`. */
  freqTo?: number;
  /** Peak gain in `[0, 1]`; defaults to {@link DEFAULT_CUE_GAIN}. */
  gain?: number;
  /** How long the cue sounds, in milliseconds. */
  durationMs: number;
}

/** How the bus obtains a Web Audio context, or `null` where there is none. */
export type AudioContextSource = () => AudioContext | null;

/** The peak gain a cue plays at when its spec names none. */
export const DEFAULT_CUE_GAIN = 0.18;

/** The floor an exponential gain ramp decays to; it cannot reach zero. */
const SILENCE_GAIN = 0.0001;

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
  private context: AudioContext | null = null;
  private mutedFlag = false;
  private disarm: (() => void) | null = null;

  constructor(source: AudioContextSource = platformAudioContext) {
    this.source = source;
  }

  /** Declare a cue under a name; redeclaring replaces it. */
  define(cue: string, spec: CueSpec): void {
    this.cues.set(cue, { ...spec });
  }

  /**
   * Play a declared cue.
   *
   * Playing one that was never declared throws, because silence is the expected
   * outcome of a muted bus and the typo would otherwise be indistinguishable
   * from an inaudible cue.
   */
  play(cue: string): void {
    const spec = this.cues.get(cue);
    if (spec === undefined) {
      throw new Error(`Meltdown: cue "${cue}" was played but never defined.`);
    }
    if (this.mutedFlag) return;
    this.sound(spec, spec.gain ?? DEFAULT_CUE_GAIN);
  }

  /** Mute or unmute the bus. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
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
      for (const type of UNLOCK_EVENTS) {
        target.removeEventListener(type, unlock);
      }
    };
  }

  /** Drop the gesture listeners and close the context. Idempotent. */
  dispose(): void {
    this.disarm?.();
    const context = this.context;
    this.context = null;
    void context?.close().catch(() => undefined);
  }

  /** Open the context, degrading to silence where the platform has none. */
  private open(): void {
    if (this.context !== null) return;
    const context = this.source();
    if (context === null) return;
    this.context = context;
    void context.resume().catch(() => undefined);
  }

  /** One oscillator through one gain envelope. Never throws into a frame. */
  private sound(spec: CueSpec, gain: number): void {
    const context = this.context;
    if (context === null || gain <= 0) return;
    try {
      const at = context.currentTime;
      const seconds = Math.max(spec.durationMs, 1) / 1000;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = spec.wave ?? "sine";
      oscillator.frequency.setValueAtTime(spec.freq, at);
      if (spec.freqTo !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(spec.freqTo, 1),
          at + seconds,
        );
      }
      envelope.gain.setValueAtTime(gain, at);
      envelope.gain.exponentialRampToValueAtTime(SILENCE_GAIN, at + seconds);
      oscillator.connect(envelope).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + seconds);
    } catch {
      // A context that died mid-frame degrades to silence, never to a thrown
      // frame.
    }
  }
}
