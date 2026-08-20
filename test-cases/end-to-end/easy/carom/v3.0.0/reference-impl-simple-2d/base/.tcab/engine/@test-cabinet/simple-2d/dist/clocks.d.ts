/**
 * The clocks the engine can be driven by.
 *
 * A {@link Clock} answers one question — how much simulated time is this frame
 * worth — and that is deliberately the *only* thing it answers. It does not know
 * whether the tick it is answering came from a host frame callback or from a
 * validator's explicit step, it does not schedule anything, and it holds no
 * reference to the engine. Everything that used to be spelled as a "clock mode"
 * is expressed by *which clock is installed* instead, which is why there is no
 * mode here to get out of sync with the clock beside it.
 *
 * The catalogue splits in two. {@link WallClock} and {@link PacedClock} read the
 * host timestamp and are what a game actually ships running under.
 * {@link ConstantClock}, {@link SequenceClock} and {@link JitterClock} ignore it
 * entirely, so the deltas they deliver depend on nothing but the number of ticks
 * they have seen — which is what lets a validator step a scenario synchronously
 * and a reviewer watch that same scenario play out at real speed.
 *
 * Every clock here is finite state: a previous timestamp, a grid position, a
 * cursor. None of them records a history, and none of them keeps anything keyed
 * by something a run produces. A clock is called once per frame for as long as a
 * game is open, so anything that accumulated per call would be a leak measured in
 * hours.
 */
import type { Clock } from "./contract";
/**
 * Real elapsed time, floored at zero and clamped to a ceiling.
 *
 * This is the clock a shipped game runs under, and both of its guards exist
 * because the raw subtraction is wrong in a way that only shows up in the field:
 *
 * - **The ceiling.** A backgrounded tab stops receiving frames and then resumes,
 *   handing the loop a gap measured in seconds or minutes. A game asked to
 *   integrate half a minute in one step tunnels through its own walls, misses
 *   every collision on the way, and lands somewhere impossible. Clamping turns
 *   that into "the game paused while you were away", which is what a player
 *   expects anyway.
 * - **The floor.** Timestamps are not guaranteed monotonic across every host and
 *   every clock adjustment, and a negative delta run through a game's integrator
 *   rewinds the simulation — velocity applied backwards, cooldowns un-expiring.
 *   Reporting zero costs one frame of motion; reporting a negative costs
 *   correctness.
 *
 * The first tick reports zero for the same reason: a delta is a measurement
 * between two frames, and there is no earlier frame to measure from. Charging the
 * game for the interval between the engine being built and its first frame would
 * advance the simulation by time that did not elapse under the loop — which, for
 * a game constructed while its assets were still loading, can be seconds.
 */
export declare class WallClock implements Clock {
    private readonly maxDeltaMs;
    /** The previous tick's timestamp, or `null` before the first tick. */
    private previousMs;
    /**
     * @param maxDeltaMs The longest delta a single frame may report. Defaults to
     * `100` — a tenth of a second, which is longer than any frame a game running
     * acceptably ever produces and short enough that a game surviving it survives
     * the clamp.
     * @throws RangeError if `maxDeltaMs` is not finite and positive. A zero or
     * negative ceiling would clamp every frame to nothing, i.e. a game that runs and
     * never moves, which is far harder to trace than a constructor that refuses.
     */
    constructor(maxDeltaMs?: number);
    /** Elapsed time since the previous tick, floored at `0` and clamped. */
    delta(nowMs: number): number;
}
/** How a {@link PacedClock} is tuned. */
export interface PacedClockOptions {
    /**
     * How many intervals the grid may fall behind before the missed slots are
     * abandoned and the grid restarts from the current tick. Defaults to `4`.
     */
    resyncAfter?: number;
}
/**
 * A fixed cadence held against an ideal grid.
 *
 * Frame `n` is due at `t0 + n * intervalMs`, where `t0` is the first tick's
 * timestamp. A tick arriving before the next due time is declined; a tick at or
 * after it delivers exactly one interval and moves the grid on by one.
 *
 * Two decisions in that sentence carry the whole design:
 *
 * - **The grid advances by one interval, not to the current time.** Pacing
 *   against when the *previous frame finished* is the obvious implementation and
 *   it drifts: every frame that overruns by a millisecond pushes the next due
 *   time out by that millisecond, permanently, so a run loses a second for every
 *   thousand slightly-long frames. Against a grid, an overrunning frame merely
 *   shortens the wait for the next one and the average rate is exactly the target.
 * - **The delta is one interval, never the measured elapsed time.** The delta the
 *   game integrates against therefore equals the delta the pacing targets. That
 *   is what makes a paced run reproducible: two runs of the same scenario see the
 *   same sequence of deltas even though no two ticks ever arrive at the same real
 *   instants.
 *
 * `resyncAfter` bounds the catch-up. Without it, a tab suspended for a minute
 * would come back owing thousands of slots and would deliver them as fast as
 * ticks arrive — a burst of frames replaying time the player was not present for,
 * during which the game is unresponsive and the simulation is somewhere in the
 * past. Dropping the missed slots costs the game a pause instead, which is both
 * what the player saw and what the wall clock's ceiling does for the same event.
 *
 * What the host can deliver still bounds the result. Ticks arrive at the display's
 * refresh rate, so a target above it yields a frame per tick, and a target the
 * refresh rate does not divide evenly yields whichever tick is nearest each ideal
 * instant rather than the instant itself.
 */
export declare class PacedClock implements Clock {
    private readonly intervalMs;
    private readonly resyncBehindMs;
    /** When the next frame is due, or `null` before the grid has been anchored. */
    private nextDueMs;
    /**
     * @param fps The target frames per second.
     * @param options See {@link PacedClockOptions}.
     * @throws RangeError if `fps` is not finite and positive, or if `resyncAfter`
     * is below `1`. A `resyncAfter` under one interval would resync on any tick
     * that was not exactly on the grid — which is every tick — and the clock would
     * silently degrade into one frame per tick with no pacing at all.
     */
    constructor(fps: number, options?: PacedClockOptions);
    /** One interval when this tick is at or past its grid slot, `null` otherwise. */
    delta(nowMs: number): number | null;
}
/**
 * The same step, every frame.
 *
 * This is the clock a check reaches for when it wants to turn a duration into a
 * frame count: `n` frames are worth exactly `n * stepMs`, with no accumulated
 * floating-point drift beyond the addition the loop itself performs, and no
 * dependence on how fast the machine running the check happens to be. Choosing a
 * step no display delivers — 240 Hz, say — is the point rather than a compromise:
 * it decouples what the specification says from what the reviewer's monitor does.
 */
export declare class ConstantClock implements Clock {
    private readonly stepMs;
    /**
     * @param stepMs What every frame is worth, in milliseconds.
     * @throws RangeError if `stepMs` is not finite and positive. A zero step would
     * run frames that simulate no time, so a check waiting on simulated time would
     * hang rather than fail — the worst failure mode a validator has.
     */
    constructor(stepMs: number);
    /** `stepMs`. The host timestamp is not consulted. */
    delta(): number;
}
/**
 * A repeating list of steps.
 *
 * This is how an uneven but exactly reproducible frame pattern is stated: four
 * fast frames, a stutter, a recovery, over and over. Real frame times are uneven,
 * and a build whose collision response only holds for 16-millisecond frames
 * passes every constant-step check ever written — so a sequence is the cheapest
 * way to put a step six times the usual size in front of it, at a known frame,
 * every run.
 *
 * The list is copied at construction. A caller that later mutates the array it
 * passed would otherwise change the meaning of a run already in progress, and a
 * clock whose whole purpose is exact replay cannot have that.
 */
export declare class SequenceClock implements Clock {
    /**
     * Typed as a non-empty tuple so the fixed first element can serve as the
     * fallback `noUncheckedIndexedAccess` demands on the cursor read below.
     */
    private readonly stepsMs;
    private index;
    /**
     * @param stepsMs The steps to deliver, in order. The list repeats.
     * @throws RangeError if the list is empty, or if any step is not finite and
     * positive — naming the offending value *and its index*, because a pattern is
     * usually computed rather than written out and "the fifth one" is the part the
     * author needs.
     */
    constructor(stepsMs: number[]);
    /** The next entry, cycling. The host timestamp is not consulted. */
    delta(): number;
}
/**
 * A seeded draw from a range, indexed by frame.
 *
 * This is the clock that stands in for a real machine under load, and the seed is
 * mandatory rather than optional on purpose. A claim that a build is delta-time
 * independent is worth making only when the failing case replays exactly: an
 * unseeded jitter that fails once in forty runs is indistinguishable from a flaky
 * check, and nobody can act on it. With a seed, the failure is a value to paste
 * into an issue.
 *
 * Equal bounds are allowed and degenerate to a constant, which keeps a
 * parameterized check that sweeps a range down to zero from needing a special
 * case.
 */
export declare class JitterClock implements Clock {
    private readonly minMs;
    private readonly spanMs;
    private readonly seed;
    /** How many deltas have been drawn — the index the hash is taken over. */
    private index;
    /**
     * @param minMs The shortest delta.
     * @param maxMs The longest delta. At least `minMs`.
     * @param seed Seeds the draw.
     * @throws RangeError if either bound is not finite and positive, if `maxMs` is
     * below `minMs`, or if `seed` is not finite. Both bounds are named in the
     * message rather than only the offending one, because the two are read
     * together and an inverted pair is the mistake being made most of the time.
     */
    constructor(minMs: number, maxMs: number, seed: number);
    /** A draw from `[minMs, maxMs]`. The host timestamp is not consulted. */
    delta(): number;
}
//# sourceMappingURL=clocks.d.ts.map