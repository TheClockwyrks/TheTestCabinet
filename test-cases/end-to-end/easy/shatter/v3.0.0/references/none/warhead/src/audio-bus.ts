// Shatter — the audio bus: named cues, synthesized on the spot.
//
// The build ships no audio files (`specs/audio.md`), so every sound is built from
// oscillators and a gain envelope through the Web Audio API. A cue is DECLARED
// once under a name and then PLAYED BY NAME as its event happens, which is what
// keeps the sound legible from outside the game: a mistyped name throws at the
// moment of the event rather than going quietly silent.
//
// Three rules the rest of the build leans on:
//
//   * Nothing about audio may fail a frame. `specs/audio.md` requires the game to
//     run, draw and play identically with no audio available at all, so a browser
//     with no Web Audio, a context that never unlocked, and a context that died
//     mid-frame each degrade to silence and never to a thrown frame.
//   * MUTED MEANS NOTHING IS EMITTED. Not a gain of zero: `specs/audio.md` says
//     every cue is silent while muting is on, and a source node started at zero
//     gain is still a sound the browser scheduled. A muted bus builds no node.
//   * The held cue is one sustained source, not a stream of blips. `thrust` is
//     started when thrust begins, sounds for as long as it is applied, and is
//     stopped on release — which is what the specification distinguishes from
//     "a single blip at the start of a burn".
//
// The context is not created until the first user gesture. One created outside a
// gesture starts suspended, and some browsers count the attempt against the page.

/**
 * The synthesis behind a named cue. Deliberately small: it covers the six sounds
 * this game needs and nothing more.
 */
export interface CueSpec {
  /** The oscillator waveform; defaults to a sine. */
  wave?: OscillatorType;
  /** The starting frequency, in hertz. */
  freq: number;
  /** The frequency to sweep to over the cue's duration; absent holds `freq`. */
  freqTo?: number;
  /** Peak gain in `[0, 1]`; defaults to {@link DEFAULT_CUE_GAIN}. */
  gain?: number;
  /** How long the cue sounds, in milliseconds. Ignored by a held cue. */
  durationMs: number;
  /**
   * Whether the cue is held: started on demand and sounding until it is stopped,
   * rather than running out on its own envelope.
   */
  held?: boolean;
}

/** How the bus obtains a Web Audio context, or `null` where there is none. */
export type AudioContextSource = () => AudioContext | null;

/** The peak gain a cue plays at when its spec names none. */
export const DEFAULT_CUE_GAIN = 0.2;

/** The floor an exponential gain ramp decays to; it cannot reach zero. */
const SILENCE_GAIN = 0.0001;

/** The seconds a held cue's gain is faded over when it is stopped. */
const HELD_RELEASE_SECONDS = 0.04;

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

/** One sounding held cue, as the bus holds it. */
interface HeldVoice {
  oscillator: OscillatorNode;
  envelope: GainNode;
}

export class AudioBus {
  private readonly cues = new Map<string, CueSpec>();
  private readonly held = new Map<string, HeldVoice>();
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
   * Play a declared one-shot cue, once.
   *
   * Playing one that was never declared throws, because silence is the expected
   * outcome of a muted bus and the typo would otherwise be indistinguishable from
   * an inaudible cue.
   */
  play(cue: string): void {
    const spec = this.spec(cue);
    if (this.mutedFlag) return;
    this.sound(spec);
  }

  /**
   * Start or stop a held cue.
   *
   * Idempotent in both directions, so the game calls it every tick with whether
   * the thrust key is down and the bus starts one voice on the tick that begins
   * the burn and stops it on the tick that ends it.
   */
  setHeld(cue: string, sounding: boolean): void {
    this.spec(cue);
    const live = this.held.get(cue);
    if (sounding && !this.mutedFlag) {
      if (live !== undefined) return;
      const voice = this.startHeld(cue);
      if (voice !== null) this.held.set(cue, voice);
      return;
    }
    if (live === undefined) return;
    this.held.delete(cue);
    this.stopVoice(live);
  }

  /** Whether a held cue is sounding right now. */
  holding(cue: string): boolean {
    return this.held.has(cue);
  }

  /** Mute or unmute the bus. Muting silences whatever is being held. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    if (!muted) return;
    for (const [cue, voice] of this.held) {
      this.held.delete(cue);
      this.stopVoice(voice);
    }
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
      for (const type of UNLOCK_EVENTS)
        target.removeEventListener(type, unlock);
    };
  }

  /** Drop the gesture listeners, stop every held voice, and close the context. */
  dispose(): void {
    this.disarm?.();
    for (const [cue, voice] of this.held) {
      this.held.delete(cue);
      this.stopVoice(voice);
    }
    const context = this.context;
    this.context = null;
    void context?.close().catch(() => undefined);
  }

  /** The declared spec for `cue`, or a throw naming the cue that was not declared. */
  private spec(cue: string): CueSpec {
    const spec = this.cues.get(cue);
    if (spec === undefined) {
      throw new Error(`Shatter: cue "${cue}" was used but never defined.`);
    }
    return spec;
  }

  /** Open the context, degrading to silence where the platform has none. */
  private open(): void {
    if (this.context !== null) return;
    const context = this.source();
    if (context === null) return;
    this.context = context;
    void context.resume().catch(() => undefined);
  }

  /** One oscillator through one decaying envelope. Never throws into a frame. */
  private sound(spec: CueSpec): void {
    const context = this.context;
    if (context === null) return;
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
      envelope.gain.setValueAtTime(spec.gain ?? DEFAULT_CUE_GAIN, at);
      envelope.gain.exponentialRampToValueAtTime(SILENCE_GAIN, at + seconds);
      oscillator.connect(envelope).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + seconds);
    } catch {
      // A context that died mid-frame degrades to silence, never to a thrown frame.
    }
  }

  /** One sustained oscillator, left running until it is stopped. */
  private startHeld(cue: string): HeldVoice | null {
    const spec = this.spec(cue);
    const context = this.context;
    if (context === null) return null;
    try {
      const at = context.currentTime;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = spec.wave ?? "sine";
      oscillator.frequency.setValueAtTime(spec.freq, at);
      if (spec.freqTo !== undefined) {
        oscillator.frequency.linearRampToValueAtTime(
          spec.freqTo,
          at + Math.max(spec.durationMs, 1) / 1000,
        );
      }
      // Ramped up rather than switched on, so beginning a burn does not click.
      envelope.gain.setValueAtTime(SILENCE_GAIN, at);
      envelope.gain.linearRampToValueAtTime(
        spec.gain ?? DEFAULT_CUE_GAIN,
        at + 0.02,
      );
      oscillator.connect(envelope).connect(context.destination);
      oscillator.start(at);
      return { oscillator, envelope };
    } catch {
      return null;
    }
  }

  /** Fade a held voice out and stop it, well inside a tenth of a second. */
  private stopVoice(voice: HeldVoice): void {
    const context = this.context;
    try {
      const at = context === null ? 0 : context.currentTime;
      voice.envelope.gain.cancelScheduledValues(at);
      voice.envelope.gain.setValueAtTime(
        Math.max(voice.envelope.gain.value, SILENCE_GAIN),
        at,
      );
      voice.envelope.gain.exponentialRampToValueAtTime(
        SILENCE_GAIN,
        at + HELD_RELEASE_SECONDS,
      );
      voice.oscillator.stop(at + HELD_RELEASE_SECONDS);
    } catch {
      // Already stopped, or the context is gone. Either way the voice is silent.
    }
  }
}
