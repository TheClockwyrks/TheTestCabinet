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
/**
 * The engine's audio bus.
 *
 * Constructed with an injectable context factory so the bus can be exercised
 * without a real Web Audio implementation — the same seam that lets it survive a
 * browser with no audio at all, since "the factory returned nothing" and "the test
 * gave me a fake" travel the same path.
 */
export declare class AudioBus {
    private readonly factory;
    private readonly cues;
    private readonly events;
    private context;
    private isMuted;
    private isUnlocked;
    constructor(factory?: () => AudioContext | null);
    /**
     * The clock the log is stamped against, in monotonic milliseconds.
     *
     * It is a method rather than a constructor argument so the engine can point it
     * at the frame loop's clock once both exist — which is what makes a cue's `t`
     * comparable to a frame count under a manual clock, where no wall time passes
     * at all. Tests override it the same way.
     */
    now(): number;
    /**
     * Declares a cue under a name. Defining an existing name replaces its spec, so
     * a game can retune a sound without having to tear the bus down.
     */
    define(cue: string, spec: CueSpec): void;
    /**
     * Plays a defined cue and records it.
     *
     * Throws if the cue was never defined: silence is the expected outcome of a
     * muted or still-locked bus, so a typo'd name would otherwise disappear into
     * the same silence and never be noticed.
     */
    play(cue: string): void;
    /** Mutes or unmutes the bus. Muted cues still play — at gain zero. */
    setMuted(muted: boolean): void;
    /** Whether the bus is muted. */
    muted(): boolean;
    /** The bus's observable state: whether it is muted, and whether it is unlocked. */
    state(): AudioState;
    /**
     * The cue log, oldest first.
     *
     * A copy, because the log is read across the host interface by a driver and a
     * caller must not be able to rewrite the record of what the build did.
     */
    log(): CueEvent[];
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
    unlock(): void;
    /**
     * One oscillator through one gain node: the frequency sweeps `freq → freqTo`
     * across the cue's duration while the gain decays to silence, and both nodes
     * stop when it ends.
     *
     * Deliberately the smallest graph that produces a recognisable bleep. Richer
     * timbre is out of scope; what matters is that the cue is heard at all and that
     * the log says it happened.
     */
    private synthesize;
}
