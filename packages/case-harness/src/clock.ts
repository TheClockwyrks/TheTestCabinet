// The step schedule, and the arithmetic that counts in it.
//
// A suite chooses the size of a frame when its case's specification leaves the
// step to the caller, and takes the one the specification fixes when it does not.
// Either way the rate is the CASE's: Refract steps 60 Hz, Carom and Fathom
// 120 Hz, Volute 60. That is why this module exports no bare `TICK_HZ` — a
// shared constant would silently halve or double every tick-denominated
// tolerance in one of those suites and still compile. The rate arrives once,
// through the case's config, and {@link makeTickMath} binds the four readings
// that depend on it.

/** A source of frame deltas, in milliseconds. */
export interface Clock {
  /** The next frame's delta, in ms. */
  delta(): number;
  /**
   * Put `frames` deltas back, so the next one handed out is the one that was
   * handed out `frames` calls ago.
   *
   * WHY A CLOCK CAN BE ASKED TO GO BACKWARDS AT ALL. A sweep that decides its
   * predicate INSIDE the page — {@link Harness.sweep}, {@link Harness.samples} —
   * runs its frames there, so it has to hand over every delta it MIGHT run before
   * the crossing opens. An early stop then leaves the clock further along than
   * the frames that actually ran, and the next sweep steps differently for it:
   * a `SequenceClock` would resume mid-pattern and a `JitterClock` at the wrong
   * index, so a check that replays would not replay. Handing the unused deltas
   * back is what keeps a sweep's cost invisible to the schedule.
   *
   * OPTIONAL, AND DELIBERATELY SO. `HarnessOptions.clock` accepts any object of
   * this shape, and the cases already write their own — deepcore's `PacedClock`,
   * meltdown's `CoastClock`, orrery's `TunableClock` are each a class of a
   * dozen lines that implements `delta` and nothing else. Making this a required
   * member would stop every one of them compiling for a member most of them
   * would implement as a no-op, so the harness calls it as `clock.rewind?.(n)`
   * and a clock that does not carry it simply keeps the deltas it handed out.
   * A clock whose `delta` depends on nothing but its arguments — the constant
   * one below — genuinely has nothing to put back, which is why implementing it
   * is a decision rather than an obligation.
   */
  rewind?(frames: number): void;
}

/** Every frame the same length. */
export class ConstantClock implements Clock {
  constructor(private readonly ms: number) {}
  delta(): number {
    return this.ms;
  }
  rewind(): void {
    // Every frame is the same length, so where the clock stands decides nothing:
    // the delta handed out after a rewind is the delta that would have been
    // handed out without one. Declared rather than left off so that the shape a
    // case copies from carries the member, and a clock swapped for a stepping one
    // needs no call site changed.
  }
}

/** A repeating pattern of steps: what an uneven but predictable display gives. */
export class SequenceClock implements Clock {
  private index = 0;
  constructor(private readonly stepsMs: readonly number[]) {
    if (stepsMs.length === 0) {
      throw new RangeError("SequenceClock needs at least one step, got none");
    }
  }
  delta(): number {
    // The constructor rejects an empty sequence, so the modulus always lands on
    // a step; the assertion states that rather than re-checking it every frame.
    const step = this.stepsMs[this.index % this.stepsMs.length] as number;
    this.index += 1;
    return step;
  }
  rewind(frames: number): void {
    // Floored at the start of the pattern, so a sweep that was handed more
    // deltas than this clock had ever produced cannot wind it past its opening
    // step and into a negative index the modulus would answer strangely for.
    this.index = Math.max(0, this.index - frames);
  }
}

/**
 * A hash of the seed and the frame index, avalanched so that neighbouring
 * indices — which is all a frame counter ever produces — do not yield
 * neighbouring outputs. The constants and the order are the engine's
 * (`packages/simple-2d/src/clocks.ts`), so a seed means the same thing here.
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

/**
 * A seeded draw from a range, indexed by frame: the clock that stands in for a
 * real machine under load. The seed is mandatory, because a claim that a build is
 * delta-time independent is worth making only when the failing case replays.
 */
export class JitterClock implements Clock {
  private index = 0;
  private readonly spanMs: number;
  constructor(
    private readonly minMs: number,
    maxMs: number,
    private readonly seed: number,
  ) {
    if (maxMs < minMs) {
      throw new RangeError(
        `JitterClock needs maxMs >= minMs, got minMs ${minMs} and maxMs ${maxMs}`,
      );
    }
    this.spanMs = maxMs - minMs;
  }
  delta(): number {
    const index = this.index;
    this.index += 1;
    return (
      this.minMs + (hash32(this.seed, index) / 0x1_0000_0000) * this.spanMs
    );
  }
  rewind(frames: number): void {
    // The draw is a pure function of the seed and the index, so winding the
    // index back is exactly as strong as never having drawn: the next delta is
    // the one the unused draw would have been. That is what makes the claim a
    // jittered check rests on — that the failing case replays — survive a sweep
    // that stopped early.
    this.index = Math.max(0, this.index - frames);
  }
}

/** The readings that depend on the rate a case's suite steps at. */
export interface TickMath {
  /** Frames (or ticks) of simulated time in one second. */
  readonly TICK_HZ: number;
  /** Seconds of simulated time in one frame. */
  readonly TICK_DT: number;
  /** Milliseconds of simulated time in one frame. */
  readonly TICK_MS: number;
  /** Seconds of simulated time in `count` frames. */
  seconds(count: number): number;
  /** Whole frames covering `duration` seconds, rounded up. */
  ticks(duration: number): number;
  /** Whole frames covering `duration` seconds, rounded up. Alias of `ticks`. */
  ticksFor(duration: number): number;
  /**
   * A SPEED from ground covered over `count` frames: the magnitude, in units per
   * second. The sign is dropped, so a paddle held left and a paddle held right
   * report the same speed and one bound covers both.
   */
  speedOverTicks(distance: number, count: number): number;
  /**
   * A signed RATE from a gain measured over `count` frames, in units per second.
   *
   * Separate from {@link speedOverTicks} on purpose, and not a variant of it: a
   * reading whose subject is that something moved FORWARD — a train advancing
   * along a channel — must fail when it moved backwards, and taking the
   * magnitude would pass it. The two spellings differ by one `Math.abs` and by
   * every verdict that rests on the direction.
   */
  gainOverTicks(gain: number, count: number): number;
}

/** Bind the tick arithmetic to the rate the case's suite steps at. */
export function makeTickMath(tickHz: number): TickMath {
  if (!Number.isFinite(tickHz) || tickHz <= 0) {
    throw new RangeError(`tickHz must be a positive number, got ${tickHz}`);
  }
  return {
    TICK_HZ: tickHz,
    TICK_DT: 1 / tickHz,
    TICK_MS: 1000 / tickHz,
    seconds: (count) => count / tickHz,
    ticks: (duration) => Math.ceil(duration * tickHz),
    ticksFor: (duration) => Math.ceil(duration * tickHz),
    speedOverTicks: (distance, count) => (Math.abs(distance) * tickHz) / count,
    gainOverTicks: (gain, count) => (gain * tickHz) / count,
  };
}
