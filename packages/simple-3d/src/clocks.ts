/**
 * The clocks the engine can be driven by.
 *
 * A {@link Clock} answers one question — how much simulated time is this frame
 * worth — and that is deliberately the *only* thing it answers. It does not know
 * whether the tick it is answering came from a host frame callback or from a
 * validator's explicit step, it does not schedule anything, and it holds no
 * reference to the engine. Everything that might otherwise be spelled as a "clock
 * mode" is expressed by *which clock is installed* instead, which is why there is
 * no mode here to get out of sync with the clock beside it.
 *
 * The catalogue splits in two. {@link WallClock} and {@link PacedClock} read the
 * host timestamp and are what a game actually ships running under.
 * {@link ConstantClock}, {@link SequenceClock} and {@link JitterClock} ignore it
 * entirely, so the deltas they deliver depend on nothing but the number of ticks
 * they have seen — which is what lets a validator step a scenario synchronously
 * and a reviewer watch that same scenario play out at real speed.
 *
 * The three scripted clocks are also how a build is shown to integrate against the
 * delta it is given rather than against a count of frames: one scenario run under
 * a constant step, a repeating pattern and a seeded draw covers the ground between
 * them, and a build that only holds together at sixteen milliseconds a frame comes
 * apart under the other two. In three dimensions that matters more, not less — a
 * body moving in world units per second tunnels through a wall at a step nobody
 * tested, and the step nobody tested is the one a real machine under load hands it.
 *
 * Every clock here is finite state: a previous timestamp, a grid position, a
 * cursor. None of them records a history, and none of them keeps anything keyed
 * by something a run produces. A clock is called once per frame for as long as a
 * game is open, so anything that accumulated per call would be a leak measured in
 * hours.
 *
 * Deltas are milliseconds throughout, because that is the unit the host timestamps
 * arrive in and converting once, at the loop's edge, beats converting in five
 * places. The engine divides by a thousand before it reaches a game's `update`,
 * which is handed seconds.
 */

import type { Clock, PacedClockOptions } from "./contract";

/** A millisecond quantity a frame loop can actually advance by. */
function isPositiveMs(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/* -------------------------------------------------------------------------- */
/* WallClock                                                                  */
/* -------------------------------------------------------------------------- */

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
 * advance the simulation by time that did not elapse under the loop — which, for a
 * game constructed while its models and textures were still decoding, can be
 * seconds.
 */
export class WallClock implements Clock {
  private readonly maxDeltaMs: number;

  /** The previous tick's timestamp, or `null` before the first tick. */
  private previousMs: number | null = null;

  /**
   * @param maxDeltaMs The longest delta a single frame may report. Defaults to
   * `100` — a tenth of a second, which is longer than any frame a game running
   * acceptably ever produces and short enough that a game surviving it survives
   * the clamp.
   * @throws RangeError if `maxDeltaMs` is not finite and positive. A zero or
   * negative ceiling would clamp every frame to nothing, i.e. a game that runs and
   * never moves, which is far harder to trace than a constructor that refuses.
   */
  constructor(maxDeltaMs = 100) {
    if (!isPositiveMs(maxDeltaMs)) {
      throw new RangeError(
        `WallClock needs a positive maxDeltaMs, got ${maxDeltaMs}`,
      );
    }
    this.maxDeltaMs = maxDeltaMs;
  }

  /** Elapsed time since the previous tick, floored at `0` and clamped. */
  delta(nowMs: number): number {
    const previousMs = this.previousMs;
    // The baseline moves to `nowMs` even when the timestamp went backwards: a
    // clock that jumped is the new truth, and holding the old baseline would turn
    // one bad timestamp into a run of floored-to-zero frames until real time
    // caught back up.
    this.previousMs = nowMs;
    if (previousMs === null) return 0;
    const elapsedMs = nowMs - previousMs;
    if (!(elapsedMs > 0)) return 0;
    return Math.min(elapsedMs, this.maxDeltaMs);
  }
}

/* -------------------------------------------------------------------------- */
/* PacedClock                                                                 */
/* -------------------------------------------------------------------------- */

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
export class PacedClock implements Clock {
  private readonly intervalMs: number;
  private readonly resyncBehindMs: number;

  /** When the next frame is due, or `null` before the grid has been anchored. */
  private nextDueMs: number | null = null;

  /**
   * @param fps The target frames per second.
   * @param options See {@link PacedClockOptions}.
   * @throws RangeError if `fps` is not finite and positive, or if `resyncAfter`
   * is below `1`. A `resyncAfter` under one interval would resync on any tick
   * that was not exactly on the grid — which is every tick — and the clock would
   * silently degrade into one frame per tick with no pacing at all.
   */
  constructor(fps: number, options: PacedClockOptions = {}) {
    if (!isPositiveMs(fps)) {
      throw new RangeError(`PacedClock needs a positive fps, got ${fps}`);
    }
    const resyncAfter = options.resyncAfter ?? 4;
    // Written as a negated `>=` so a `NaN` is rejected by the same comparison.
    if (!(resyncAfter >= 1)) {
      throw new RangeError(
        `PacedClock needs a resyncAfter of at least 1, got ${resyncAfter}`,
      );
    }
    this.intervalMs = 1000 / fps;
    this.resyncBehindMs = this.intervalMs * resyncAfter;
  }

  /** One interval when this tick is at or past its grid slot, `null` otherwise. */
  delta(nowMs: number): number | null {
    // The grid is anchored on the first tick rather than at construction, because
    // an engine is often built well before its first frame — while a glTF model
    // decodes, or while a driver poses a scenario — and anchoring early would make
    // the first tick arrive hundreds of slots behind and immediately resync.
    const dueMs = this.nextDueMs ?? nowMs;
    if (nowMs < dueMs) return null;

    this.nextDueMs =
      nowMs - dueMs > this.resyncBehindMs
        ? nowMs + this.intervalMs
        : dueMs + this.intervalMs;
    return this.intervalMs;
  }
}

/* -------------------------------------------------------------------------- */
/* ConstantClock                                                              */
/* -------------------------------------------------------------------------- */

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
export class ConstantClock implements Clock {
  private readonly stepMs: number;

  /**
   * @param stepMs What every frame is worth, in milliseconds.
   * @throws RangeError if `stepMs` is not finite and positive. A zero step would
   * run frames that simulate no time, so a check waiting on simulated time would
   * hang rather than fail — the worst failure mode a validator has.
   */
  constructor(stepMs: number) {
    if (!isPositiveMs(stepMs)) {
      throw new RangeError(
        `ConstantClock needs a positive stepMs, got ${stepMs}`,
      );
    }
    this.stepMs = stepMs;
  }

  /** `stepMs`. The host timestamp is not consulted. */
  delta(): number {
    return this.stepMs;
  }
}

/* -------------------------------------------------------------------------- */
/* SequenceClock                                                              */
/* -------------------------------------------------------------------------- */

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
export class SequenceClock implements Clock {
  /**
   * Typed as a non-empty tuple so the fixed first element can serve as the
   * fallback `noUncheckedIndexedAccess` demands on the cursor read below.
   */
  private readonly stepsMs: readonly [number, ...number[]];

  private index = 0;

  /**
   * @param stepsMs The steps to deliver, in order. The list repeats.
   * @throws RangeError if the list is empty, or if any step is not finite and
   * positive — naming the offending value *and its index*, because a pattern is
   * usually computed rather than written out and "the fifth one" is the part the
   * author needs.
   */
  constructor(stepsMs: number[]) {
    const [first, ...rest] = stepsMs;
    if (first === undefined) {
      throw new RangeError("SequenceClock needs at least one step, got none");
    }
    const bad = stepsMs.findIndex((step) => !isPositiveMs(step));
    if (bad !== -1) {
      throw new RangeError(
        `SequenceClock needs positive steps, got ${stepsMs[bad]} at index ${bad}`,
      );
    }
    this.stepsMs = [first, ...rest];
  }

  /** The next entry, cycling. The host timestamp is not consulted. */
  delta(): number {
    const step = this.stepsMs[this.index] ?? this.stepsMs[0];
    // The cursor wraps rather than counting frames, so it is bounded by the
    // list's length however long the game runs.
    this.index = (this.index + 1) % this.stepsMs.length;
    return step;
  }
}

/* -------------------------------------------------------------------------- */
/* JitterClock                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A 32-bit integer hash of `(seed, index)`.
 *
 * A hash rather than a stateful pseudo-random generator because the draw is
 * *indexed*, not streamed: frame 900's delta must be the same whether it was
 * reached by running 900 frames or asked for directly, and it must survive a
 * frame being run twice or skipped without the whole tail of the sequence
 * shifting. A stream position is one more piece of state that can drift out of
 * step with the frame counter; an index cannot.
 *
 * The avalanche steps — the shift-xor / multiply rounds, in the murmur3 finalizer
 * family — are what stop neighbouring indices, which is all a frame counter ever
 * produces, from yielding neighbouring outputs. Without them the "jitter" is a
 * slow ramp: every frame slightly longer than the last, which is not what a real
 * frame trace looks like and is not the thing the check means to test against.
 *
 * The constants and the operation order are fixed, and are the ones the sibling
 * engines use, so a seed quoted in a bug report replays to the same deltas
 * wherever it is pasted.
 */
function hash32(seed: number, index: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca6b)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/** The hash as a uniform `[0, 1)` float. */
function unit(seed: number, index: number): number {
  return hash32(seed, index) / 0x1_0000_0000;
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
export class JitterClock implements Clock {
  private readonly minMs: number;
  private readonly spanMs: number;
  private readonly seed: number;

  /** How many deltas have been drawn — the index the hash is taken over. */
  private index = 0;

  /**
   * @param minMs The shortest delta.
   * @param maxMs The longest delta. At least `minMs`.
   * @param seed Seeds the draw.
   * @throws RangeError if either bound is not finite and positive, if `maxMs` is
   * below `minMs`, or if `seed` is not finite. Both bounds are named in the
   * message rather than only the offending one, because the two are read
   * together and an inverted pair is the mistake being made most of the time.
   */
  constructor(minMs: number, maxMs: number, seed: number) {
    if (!isPositiveMs(minMs) || !isPositiveMs(maxMs)) {
      throw new RangeError(
        `JitterClock needs positive bounds, got minMs ${minMs} and maxMs ${maxMs}`,
      );
    }
    if (maxMs < minMs) {
      throw new RangeError(
        `JitterClock needs maxMs >= minMs, got minMs ${minMs} and maxMs ${maxMs}`,
      );
    }
    if (!Number.isFinite(seed)) {
      throw new RangeError(`JitterClock needs a finite seed, got ${seed}`);
    }
    this.minMs = minMs;
    this.spanMs = maxMs - minMs;
    this.seed = seed;
  }

  /** A draw from `[minMs, maxMs]`. The host timestamp is not consulted. */
  delta(): number {
    const index = this.index;
    this.index = index + 1;
    return this.minMs + unit(this.seed, index) * this.spanMs;
  }
}
