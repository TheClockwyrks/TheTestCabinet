import { describe, expect, it } from "vitest";
import {
  ConstantClock,
  JitterClock,
  PacedClock,
  SequenceClock,
  WallClock,
} from "./clocks";
import type { Clock } from "./contract";

/** The results of ticking `clock` at each of `times`, in order. */
function tickAll(clock: Clock, times: number[]): (number | null)[] {
  return times.map((t) => clock.delta(t));
}

/** `count` ticks of a clock that ignores the timestamp. */
function deltas(clock: Clock, count: number): number[] {
  return Array.from({ length: count }, () => clock.delta(0) ?? Number.NaN);
}

describe("WallClock", () => {
  it("reports zero for the first frame, which has nothing to measure from", () => {
    expect(new WallClock().delta(1_000)).toBe(0);
    // The baseline is the first tick's timestamp, not zero: an engine built long
    // before its first frame must not be charged for the wait.
    const clock = new WallClock();
    clock.delta(1_000);
    expect(clock.delta(1_016)).toBe(16);
  });

  it("reports the elapsed time between ticks", () => {
    const clock = new WallClock();

    expect(tickAll(clock, [100, 116, 132.5, 140])).toEqual([0, 16, 16.5, 7.5]);
  });

  it("clamps a long gap to the ceiling", () => {
    const clock = new WallClock();
    clock.delta(0);

    expect(clock.delta(5_000)).toBe(100);
    // And the clamp does not disturb the baseline: the frame after the gap is
    // measured from the gap's end, not from where the ceiling would have put it.
    expect(clock.delta(5_016)).toBe(16);
  });

  it("honours a custom ceiling, including one below a typical frame", () => {
    const clock = new WallClock(8);
    clock.delta(0);

    expect(clock.delta(16)).toBe(8);
    expect(clock.delta(20)).toBe(4);
  });

  it("floors a backwards timestamp at zero rather than rewinding the sim", () => {
    const clock = new WallClock();
    clock.delta(1_000);

    expect(clock.delta(900)).toBe(0);
  });

  it("takes a backwards timestamp as the new baseline", () => {
    const clock = new WallClock();
    clock.delta(1_000);
    clock.delta(900);

    // Measured from 900, not from 1_000 — otherwise one bad timestamp would floor
    // every frame until real time caught back up.
    expect(clock.delta(916)).toBe(16);
  });

  it("reports zero for two ticks at the same instant", () => {
    const clock = new WallClock();
    clock.delta(500);

    expect(clock.delta(500)).toBe(0);
  });

  it("rejects a ceiling a frame loop cannot run under", () => {
    expect(() => new WallClock(0)).toThrow(RangeError);
    expect(() => new WallClock(0)).toThrow(/maxDeltaMs, got 0/);
    expect(() => new WallClock(-1)).toThrow(/maxDeltaMs, got -1/);
    expect(() => new WallClock(Number.NaN)).toThrow(RangeError);
    expect(() => new WallClock(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("accepts an omitted ceiling and any positive one", () => {
    expect(() => new WallClock()).not.toThrow();
    expect(() => new WallClock(0.5)).not.toThrow();
    expect(() => new WallClock(10_000)).not.toThrow();
  });
});

describe("PacedClock", () => {
  const INTERVAL = 1000 / 60;

  it("anchors the grid on the first tick and delivers that tick", () => {
    const clock = new PacedClock(60);

    // Anchoring at construction would leave the first tick hundreds of slots
    // behind for an engine built while its assets loaded.
    expect(clock.delta(9_000_000)).toBe(INTERVAL);
    expect(clock.delta(9_000_000)).toBeNull();
  });

  it("declines a tick before the next slot and delivers one at or after it", () => {
    const clock = new PacedClock(60);
    clock.delta(0);

    expect(clock.delta(INTERVAL - 0.001)).toBeNull();
    expect(clock.delta(INTERVAL)).toBe(INTERVAL);
    expect(clock.delta(INTERVAL + 0.5)).toBeNull();
  });

  it("delivers one interval whatever the tick's real arrival time", () => {
    const clock = new PacedClock(60);
    clock.delta(0);

    // 40ms of real time elapsed, but the frame is worth one interval — that is
    // what makes the delta the game integrates equal the delta pacing targets.
    expect(clock.delta(40)).toBe(INTERVAL);
  });

  it("shortens the wait after an overrun instead of drifting", () => {
    const clock = new PacedClock(60);
    clock.delta(0); // grid: next due at one interval

    // 30ms in, the second frame is late but still within the resync bound, so the
    // grid moves on by exactly one slot rather than restarting at 30.
    expect(clock.delta(30)).toBe(INTERVAL);
    // The third slot is at 2 intervals ≈ 33.3, so the wait is now ~3ms, not 16.7.
    expect(clock.delta(32)).toBeNull();
    expect(clock.delta(2 * INTERVAL)).toBe(INTERVAL);
  });

  it("holds its average rate over a run of one-millisecond ticks", () => {
    const clock = new PacedClock(60);
    const times = Array.from({ length: 1_001 }, (_, i) => i);
    const hits: number[] = [];

    times.forEach((t) => {
      if (clock.delta(t) !== null) hits.push(t);
    });

    // Frame n is due at n * interval, so a second holds frames 0 through 60.
    expect(hits.length).toBe(61);
    hits.forEach((at, n) => {
      // Each frame lands on the tick nearest its ideal instant, so the error
      // against the grid never accumulates past the one-millisecond tick
      // granularity — the 60th frame is as close to its slot as the first. Pacing
      // against the previous frame's completion instead would be ~60ms out by the
      // end of this run.
      expect(Math.abs(at - n * INTERVAL)).toBeLessThanOrEqual(1);
    });
  });

  it("replays the missed slots when the lag is inside the resync bound", () => {
    const clock = new PacedClock(60);
    clock.delta(0);

    // 60ms is 3.6 intervals past the first slot — behind by less than the default
    // four — so the catch-up runs rather than the grid restarting.
    expect(tickAll(clock, [60, 60, 60, 60])).toEqual([
      INTERVAL,
      INTERVAL,
      INTERVAL,
      null,
    ]);
  });

  it("abandons the missed slots after a long stall", () => {
    const clock = new PacedClock(60);
    clock.delta(0);

    // A one-second stall owes 60 slots. It costs a pause, not a burst of frames
    // replaying time the player was not present for.
    expect(clock.delta(1_000)).toBe(INTERVAL);
    expect(clock.delta(1_000)).toBeNull();
    expect(clock.delta(1_000 + INTERVAL)).toBe(INTERVAL);
  });

  it("resyncs strictly beyond the bound, not at it", () => {
    const atBound = new PacedClock(100, { resyncAfter: 1 });
    atBound.delta(0); // next due at 10

    // Exactly one interval behind: still a catch-up, so the grid keeps its phase
    // and the missed slot is delivered at the same tick time.
    expect(atBound.delta(20)).toBe(10);
    expect(atBound.delta(20)).toBe(10);

    const past = new PacedClock(100, { resyncAfter: 1 });
    past.delta(0);

    // A hair further behind restarts the grid from the tick instead.
    expect(past.delta(20.1)).toBe(10);
    expect(past.delta(20.1)).toBeNull();
  });

  it("lets a larger resyncAfter tolerate a longer stall", () => {
    const clock = new PacedClock(60, { resyncAfter: 100 });
    clock.delta(0);

    // 1000ms is ~60 intervals behind: under the default this resyncs, under 100
    // it catches up.
    expect(clock.delta(1_000)).toBe(INTERVAL);
    expect(clock.delta(1_000)).toBe(INTERVAL);
  });

  it("yields a frame per tick when the target is above the tick rate", () => {
    const clock = new PacedClock(1_000);

    // Ticks 16ms apart against a 1ms interval: every tick is past its slot.
    expect(tickAll(clock, [0, 16, 32, 48])).toEqual([1, 1, 1, 1]);
  });

  it("rejects an unrunnable fps", () => {
    expect(() => new PacedClock(0)).toThrow(RangeError);
    expect(() => new PacedClock(0)).toThrow(/fps, got 0/);
    expect(() => new PacedClock(-60)).toThrow(/fps, got -60/);
    expect(() => new PacedClock(Number.NaN)).toThrow(RangeError);
    expect(() => new PacedClock(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("rejects a resyncAfter below one interval", () => {
    expect(() => new PacedClock(60, { resyncAfter: 0 })).toThrow(RangeError);
    expect(() => new PacedClock(60, { resyncAfter: 0 })).toThrow(
      /resyncAfter of at least 1, got 0/,
    );
    expect(() => new PacedClock(60, { resyncAfter: 0.99 })).toThrow(RangeError);
    expect(() => new PacedClock(60, { resyncAfter: -4 })).toThrow(RangeError);
    expect(() => new PacedClock(60, { resyncAfter: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it("accepts the boundary and an omitted resyncAfter", () => {
    expect(() => new PacedClock(60)).not.toThrow();
    expect(() => new PacedClock(60, {})).not.toThrow();
    expect(() => new PacedClock(60, { resyncAfter: 1 })).not.toThrow();
    expect(() => new PacedClock(29.97)).not.toThrow();
  });
});

describe("ConstantClock", () => {
  it("hands every frame the same step", () => {
    const clock = new ConstantClock(16);

    expect(deltas(clock, 5)).toEqual([16, 16, 16, 16, 16]);
  });

  it("ignores the host timestamp entirely", () => {
    const clock = new ConstantClock(4);

    expect(tickAll(clock, [0, 5_000, 1, Number.NaN])).toEqual([4, 4, 4, 4]);
  });

  it("makes n frames worth exactly n steps", () => {
    const stepMs = 1000 / 240;
    const clock = new ConstantClock(stepMs);
    const total = deltas(clock, 360).reduce((a, b) => a + b, 0);

    expect(total).toBeCloseTo(1_500, 6);
  });

  it("rejects a step a frame loop cannot advance by", () => {
    expect(() => new ConstantClock(0)).toThrow(RangeError);
    expect(() => new ConstantClock(0)).toThrow(/stepMs, got 0/);
    expect(() => new ConstantClock(-16)).toThrow(/stepMs, got -16/);
    expect(() => new ConstantClock(Number.NaN)).toThrow(RangeError);
    expect(() => new ConstantClock(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});

describe("SequenceClock", () => {
  it("walks the list and then repeats it", () => {
    const clock = new SequenceClock([8, 33, 4]);

    expect(deltas(clock, 7)).toEqual([8, 33, 4, 8, 33, 4, 8]);
  });

  it("handles a single-entry list as a constant", () => {
    expect(deltas(new SequenceClock([16]), 3)).toEqual([16, 16, 16]);
  });

  it("ignores the host timestamp entirely", () => {
    const clock = new SequenceClock([8, 33]);

    expect(tickAll(clock, [0, 0, 9_999, 9_999])).toEqual([8, 33, 8, 33]);
  });

  it("copies the list, so a caller mutating it cannot change a run in flight", () => {
    const pattern = [8, 33];
    const clock = new SequenceClock(pattern);
    pattern[0] = 999;
    pattern.push(1);

    expect(deltas(clock, 4)).toEqual([8, 33, 8, 33]);
  });

  it("keeps its cursor bounded rather than counting frames", () => {
    const pattern = [4, 4, 4, 4, 33, 16];
    const clock = new SequenceClock(pattern);
    const seen = deltas(clock, pattern.length * 20_000);

    // Nothing accumulates: after 120,000 frames the clock is exactly where a
    // fresh one is at the same phase, and it has produced only the six values.
    expect(new Set(seen)).toEqual(new Set(pattern));
    expect(deltas(clock, pattern.length)).toEqual(pattern);
  });

  it("rejects an empty list", () => {
    expect(() => new SequenceClock([])).toThrow(RangeError);
    expect(() => new SequenceClock([])).toThrow(/at least one step/);
  });

  it("rejects a step that is not finite and positive, naming its index", () => {
    expect(() => new SequenceClock([8, 0, 4])).toThrow(RangeError);
    expect(() => new SequenceClock([8, 0, 4])).toThrow(/got 0 at index 1/);
    expect(() => new SequenceClock([8, 33, -4])).toThrow(/got -4 at index 2/);
    expect(() => new SequenceClock([Number.NaN])).toThrow(/at index 0/);
    expect(() => new SequenceClock([8, Number.POSITIVE_INFINITY])).toThrow(
      /at index 1/,
    );
  });
});

describe("JitterClock", () => {
  const SEED = 20260819;

  it("replays exactly under the same seed", () => {
    const first = deltas(new JitterClock(4, 40, SEED), 200);
    const second = deltas(new JitterClock(4, 40, SEED), 200);

    expect(second).toEqual(first);
  });

  it("is indexed rather than streamed: frame i has one answer", () => {
    const reference = deltas(new JitterClock(4, 40, SEED), 64);

    // A clock stepped to frame 40 the long way agrees with the reference at 40,
    // which is the property a stream position could not guarantee if a frame were
    // ever run twice or skipped.
    const walked = new JitterClock(4, 40, SEED);
    deltas(walked, 40);
    expect(walked.delta()).toBe(reference[40]);
  });

  it("ignores the host timestamp entirely", () => {
    const byTime = tickAll(new JitterClock(4, 40, SEED), [0, 9_999, -5, 12]);

    expect(byTime).toEqual(deltas(new JitterClock(4, 40, SEED), 4));
  });

  it("gives a different sequence for a different seed", () => {
    expect(deltas(new JitterClock(4, 40, SEED + 1), 32)).not.toEqual(
      deltas(new JitterClock(4, 40, SEED), 32),
    );
  });

  it("stays inside its bounds across many frames", () => {
    const clock = new JitterClock(4, 40, SEED);

    for (let i = 0; i < 5_000; i += 1) {
      const step = clock.delta();
      expect(step).toBeGreaterThanOrEqual(4);
      expect(step).toBeLessThanOrEqual(40);
    }
  });

  it("actually jitters rather than ramping with the frame counter", () => {
    const sample = deltas(new JitterClock(4, 40, SEED), 2_000);
    const mid = (4 + 40) / 2;
    const low = sample.filter((s) => s < mid).length;
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;

    // Roughly uniform: both halves of the range are well populated and the mean
    // sits near the midpoint. A hash that failed to avalanche would walk one
    // direction and blow both of these.
    expect(low).toBeGreaterThan(800);
    expect(low).toBeLessThan(1_200);
    expect(mean).toBeGreaterThan(mid - 2);
    expect(mean).toBeLessThan(mid + 2);
  });

  it("degenerates cleanly when the bounds are equal", () => {
    expect(deltas(new JitterClock(16, 16, 7), 4)).toEqual([16, 16, 16, 16]);
  });

  it("rejects bounds that are not finite and positive, naming both", () => {
    expect(() => new JitterClock(0, 40, 1)).toThrow(RangeError);
    expect(() => new JitterClock(0, 40, 1)).toThrow(/minMs 0 and maxMs 40/);
    expect(() => new JitterClock(4, 0, 1)).toThrow(/minMs 4 and maxMs 0/);
    expect(() => new JitterClock(-4, 40, 1)).toThrow(RangeError);
    expect(() => new JitterClock(4, Number.POSITIVE_INFINITY, 1)).toThrow(
      RangeError,
    );
    expect(() => new JitterClock(Number.NaN, 40, 1)).toThrow(RangeError);
  });

  it("rejects an inverted range, naming both bounds", () => {
    expect(() => new JitterClock(20, 5, 1)).toThrow(RangeError);
    expect(() => new JitterClock(20, 5, 1)).toThrow(/minMs 20 and maxMs 5/);
  });

  it("rejects a non-finite seed", () => {
    expect(() => new JitterClock(4, 40, Number.NaN)).toThrow(RangeError);
    expect(() => new JitterClock(4, 40, Number.NaN)).toThrow(/finite seed/);
    expect(() => new JitterClock(4, 40, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it("accepts a zero and a negative seed", () => {
    expect(() => new JitterClock(4, 40, 0)).not.toThrow();
    expect(() => new JitterClock(4, 40, -1)).not.toThrow();
  });
});
