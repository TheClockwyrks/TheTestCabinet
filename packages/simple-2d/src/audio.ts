/**
 * The engine's audio bus: named cues, synthesized on demand, and a log of every
 * cue that played.
 *
 * The engine owns synthesis rather than handing the game a Web Audio context,
 * because a produced 2D game needs a handful of bleeps and should not have to
 * relearn oscillators, gain envelopes and the autoplay policy to get them. A game
 * declares a cue once and plays it by name; everything below that name — the
 * graph, the unlock, the mute — belongs here.
 *
 * The *log* is the load-bearing part. A driver cannot listen to a headless
 * browser, so "did the build make a noise when the ball bounced" is only
 * answerable if playing a cue leaves a semantic record behind. Two consequences
 * shape this file:
 *
 * - A cue is recorded whether or not anything is audible — muted, still locked,
 *   or running with no audio support at all. Audibility is a property of the
 *   environment; the game reacting to an event is a property of the build, and
 *   only the second is what a driver is trying to establish.
 * - Nothing about audio is allowed to fail a run. A browser that refuses to give
 *   us a context, or one whose context dies mid-frame, degrades the bus to a
 *   log-only bus rather than throwing into the game's frame callback.
 *
 * The one thing that *does* throw is playing a cue that was never defined: that
 * is a typo in the build, it would otherwise be silently indistinguishable from a
 * cue that played inaudibly, and failing loudly is the only way it gets noticed.
 */

import type { AudioState, CueEvent, CueSpec } from "./contract";

/** The peak gain a cue plays at when its spec does not name one. */
const DEFAULT_CUE_GAIN = 0.2;

/**
 * The floor an exponential gain ramp decays to. `exponentialRampToValueAtTime`
 * cannot reach zero, so the envelope lands on an inaudible value instead and the
 * oscillator is stopped there.
 */
const SILENCE_GAIN = 0.0001;

/**
 * Creates the browser's audio context, or `null` where there isn't one.
 *
 * Construction is deferred to {@link AudioBus.unlock} rather than done here at
 * import time on purpose: a context created outside a user gesture starts
 * suspended, and some browsers count the attempt against the page.
 */
function defaultContextFactory(): AudioContext | null {
  const ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  return ctor ? new ctor() : null;
}

/**
 * The engine's audio bus.
 *
 * Constructed with an injectable context factory so the bus can be exercised
 * without a real Web Audio implementation — the same seam that lets it survive a
 * browser with no audio at all, since "the factory returned nothing" and "the test
 * gave me a fake" travel the same path.
 */
export class AudioBus {
  private readonly factory: () => AudioContext | null;
  private readonly cues = new Map<string, CueSpec>();
  private readonly events: CueEvent[] = [];
  private context: AudioContext | null = null;
  private isMuted = false;
  private isUnlocked = false;

  constructor(factory: () => AudioContext | null = defaultContextFactory) {
    this.factory = factory;
  }

  /**
   * The clock the log is stamped against, in monotonic milliseconds.
   *
   * It is a method rather than a constructor argument so the engine can point it
   * at the frame loop's clock once both exist — which is what makes a cue's `t`
   * comparable to a frame count under a manual clock, where no wall time passes
   * at all. Tests override it the same way.
   */
  now(): number {
    return performance.now();
  }

  /**
   * Declares a cue under a name. Defining an existing name replaces its spec, so
   * a game can retune a sound without having to tear the bus down.
   */
  define(cue: string, spec: CueSpec): void {
    this.cues.set(cue, spec);
  }

  /**
   * Plays a defined cue and records it.
   *
   * Throws if the cue was never defined: silence is the expected outcome of a
   * muted or still-locked bus, so a typo'd name would otherwise disappear into
   * the same silence and never be noticed.
   */
  play(cue: string): void {
    const spec = this.cues.get(cue);
    if (!spec) {
      throw new Error(
        `unknown audio cue "${cue}" — define it with audio.define("${cue}", spec) before playing it`,
      );
    }

    // Mute is expressed as a gain of zero in the log rather than as a missing
    // entry, so a driver can still establish that the build reacted to the event
    // and can tell a muted game apart from an unresponsive one.
    const gain = this.isMuted ? 0 : (spec.gain ?? DEFAULT_CUE_GAIN);
    this.events.push({ cue, t: this.now(), gain });

    // Below this line is audibility only. No context yet (still locked, or no
    // audio support), or nothing to hear anyway, and the log is the whole result.
    if (!this.context || gain <= 0) return;
    this.synthesize(spec, gain);
  }

  /** Mutes or unmutes the bus. Muted cues still play — at gain zero. */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  /** Whether the bus is muted. */
  muted(): boolean {
    return this.isMuted;
  }

  /** The bus's observable state: whether it is muted, and whether it is unlocked. */
  state(): AudioState {
    return { muted: this.isMuted, unlocked: this.isUnlocked };
  }

  /**
   * The cue log, oldest first.
   *
   * A copy, because the log is read across the host interface by a driver and a
   * caller must not be able to rewrite the record of what the build did.
   */
  log(): CueEvent[] {
    return [...this.events];
  }

  /**
   * Opens the audio context. Must be called from a real user gesture, since
   * browsers refuse to start audio outside one.
   *
   * Idempotent: repeated gestures (every click of a game's first screen) must not
   * pile up contexts. `unlocked` records that the gesture happened even when no
   * context could be created — the gesture is the bit a driver is missing when it
   * sees a silent build, and whether the browser then had audio to offer is a
   * separate question the empty graph already answers.
   */
  unlock(): void {
    if (this.isUnlocked) return;
    this.isUnlocked = true;

    try {
      this.context = this.factory();
    } catch {
      // A browser that refuses us a context is a browser the game runs in
      // silently, not one it fails to run in.
      this.context = null;
      return;
    }

    // A context created inside a gesture usually starts running, but one carried
    // over from a suspended page does not; resuming is cheap and covers both.
    this.context?.resume().catch(() => undefined);
  }

  /**
   * One oscillator through one gain node: the frequency sweeps `freq → freqTo`
   * across the cue's duration while the gain decays to silence, and both nodes
   * stop when it ends.
   *
   * Deliberately the smallest graph that produces a recognisable bleep. Richer
   * timbre is out of scope; what matters is that the cue is heard at all and that
   * the log says it happened.
   */
  private synthesize(spec: CueSpec, gain: number): void {
    const ctx = this.context;
    if (!ctx) return;

    try {
      const start = ctx.currentTime;
      const end = start + Math.max(spec.durationMs, 0) / 1000;

      const osc = ctx.createOscillator();
      osc.type = spec.wave ?? "sine";
      osc.frequency.setValueAtTime(spec.freq, start);
      osc.frequency.linearRampToValueAtTime(spec.freqTo ?? spec.freq, end);

      const amp = ctx.createGain();
      amp.gain.setValueAtTime(gain, start);
      amp.gain.exponentialRampToValueAtTime(SILENCE_GAIN, end);

      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(start);
      osc.stop(end);
    } catch {
      // A context that has been closed (or a browser that throws from somewhere
      // inside the graph) must not take the frame down with it. The cue is
      // already logged; the game carries on without the sound.
    }
  }
}
