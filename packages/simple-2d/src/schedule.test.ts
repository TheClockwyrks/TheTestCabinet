import { describe, expect, it } from "vitest";
import type { Schedule } from "./contract";
import { DEFAULT_SCHEDULE, scheduleStep, validateSchedule } from "./schedule";

/** The steps for frames `0..count-1`. */
function steps(schedule: Schedule, count: number): number[] {
  return Array.from({ length: count }, (_, i) => scheduleStep(schedule, i));
}

describe("DEFAULT_SCHEDULE", () => {
  it("is a fixed 120 Hz step, matching the tick rate cases instrument at", () => {
    expect(DEFAULT_SCHEDULE.kind).toBe("fixed");
    expect(DEFAULT_SCHEDULE.stepMs).toBeCloseTo(1000 / 120, 9);
  });
});

describe("scheduleStep — fixed", () => {
  it("hands every frame the same step", () => {
    const schedule: Schedule = { kind: "fixed", stepMs: 16 };
    expect(steps(schedule, 5)).toEqual([16, 16, 16, 16, 16]);
    expect(scheduleStep(schedule, 99_999)).toBe(16);
  });
});

describe("scheduleStep — sequence", () => {
  it("walks the list and then repeats it", () => {
    const schedule: Schedule = { kind: "sequence", stepsMs: [8, 33, 4] };

    expect(steps(schedule, 7)).toEqual([8, 33, 4, 8, 33, 4, 8]);
  });

  it("falls back to the default step for an empty sequence", () => {
    const schedule: Schedule = { kind: "sequence", stepsMs: [] };

    expect(scheduleStep(schedule, 0)).toBe(DEFAULT_SCHEDULE.stepMs);
    expect(scheduleStep(schedule, 7)).toBe(DEFAULT_SCHEDULE.stepMs);
  });

  it("folds an out-of-range index back into the cycle", () => {
    const schedule: Schedule = { kind: "sequence", stepsMs: [8, 33, 4] };

    expect(scheduleStep(schedule, -1)).toBe(4);
    expect(scheduleStep(schedule, 2.9)).toBe(4);
    expect(scheduleStep(schedule, Number.NaN)).toBe(8);
  });
});

describe("scheduleStep — jitter", () => {
  const schedule: Schedule = {
    kind: "jitter",
    minMs: 4,
    maxMs: 40,
    seed: 1234,
  };

  it("is reproducible: the same seed and index always give the same step", () => {
    const first = steps(schedule, 64);
    const second = steps(schedule, 64);

    expect(second).toEqual(first);
    // Order of access does not matter either — the step is a function of the index,
    // not of a stream position.
    expect(scheduleStep(schedule, 40)).toBe(first[40]);
    expect(scheduleStep(schedule, 3)).toBe(first[3]);
  });

  it("gives a different sequence for a different seed", () => {
    const other: Schedule = { ...schedule, seed: 1235 };

    expect(steps(other, 32)).not.toEqual(steps(schedule, 32));
  });

  it("stays inside its bounds across many frames", () => {
    for (let i = 0; i < 5_000; i += 1) {
      const step = scheduleStep(schedule, i);
      expect(step).toBeGreaterThanOrEqual(4);
      expect(step).toBeLessThanOrEqual(40);
    }
  });

  it("actually jitters rather than ramping with the frame counter", () => {
    const sample = steps(schedule, 2_000);
    const mid = (4 + 40) / 2;
    const low = sample.filter((s) => s < mid).length;
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;

    // Roughly uniform: both halves of the range are well populated and the mean sits
    // near the midpoint. A hash that failed to avalanche would walk one direction and
    // blow both of these.
    expect(low).toBeGreaterThan(800);
    expect(low).toBeLessThan(1_200);
    expect(mean).toBeGreaterThan(mid - 2);
    expect(mean).toBeLessThan(mid + 2);
  });

  it("degenerates cleanly when the bounds are equal", () => {
    expect(scheduleStep({ kind: "jitter", minMs: 16, maxMs: 16, seed: 7 }, 3)).toBe(16);
  });
});

describe("validateSchedule", () => {
  it("accepts the schedules a frame loop can run", () => {
    expect(() => validateSchedule(DEFAULT_SCHEDULE)).not.toThrow();
    expect(() =>
      validateSchedule({ kind: "sequence", stepsMs: [8, 33] }),
    ).not.toThrow();
    // An empty sequence is not an error: `scheduleStep` falls back to the default.
    expect(() =>
      validateSchedule({ kind: "sequence", stepsMs: [] }),
    ).not.toThrow();
    expect(() =>
      validateSchedule({ kind: "jitter", minMs: 4, maxMs: 40, seed: 0 }),
    ).not.toThrow();
    expect(() =>
      validateSchedule({ kind: "jitter", minMs: 16, maxMs: 16, seed: 0 }),
    ).not.toThrow();
  });

  it("rejects a non-positive or non-finite fixed step", () => {
    expect(() => validateSchedule({ kind: "fixed", stepMs: 0 })).toThrow(
      /positive stepMs/,
    );
    expect(() => validateSchedule({ kind: "fixed", stepMs: -16 })).toThrow(
      /positive stepMs/,
    );
    expect(() =>
      validateSchedule({ kind: "fixed", stepMs: Number.NaN }),
    ).toThrow(/positive stepMs/);
    expect(() =>
      validateSchedule({ kind: "fixed", stepMs: Number.POSITIVE_INFINITY }),
    ).toThrow(/positive stepMs/);
  });

  it("rejects a sequence containing a non-positive step, naming the offender", () => {
    expect(() =>
      validateSchedule({ kind: "sequence", stepsMs: [8, 0, 33] }),
    ).toThrow(/index 1/);
    expect(() =>
      validateSchedule({ kind: "sequence", stepsMs: [8, -1] }),
    ).toThrow(/positive steps/);
  });

  it("rejects an inverted or non-positive jitter range", () => {
    expect(() =>
      validateSchedule({ kind: "jitter", minMs: 20, maxMs: 5, seed: 1 }),
    ).toThrow(/maxMs >= minMs/);
    expect(() =>
      validateSchedule({ kind: "jitter", minMs: 0, maxMs: 5, seed: 1 }),
    ).toThrow(/positive bounds/);
    expect(() =>
      validateSchedule({
        kind: "jitter",
        minMs: 4,
        maxMs: 40,
        seed: Number.NaN,
      }),
    ).toThrow(/finite seed/);
  });

  it("rejects an unknown kind, since a schedule arrives as untyped JSON", () => {
    const bogus = { kind: "every-other-tuesday", stepMs: 16 } as unknown as Schedule;

    expect(() => validateSchedule(bogus)).toThrow(/every-other-tuesday/);
  });
});
