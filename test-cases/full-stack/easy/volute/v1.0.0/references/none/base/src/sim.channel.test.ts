// The channel as the tick drives it: what a level opens with, how the inlet feeds
// it, and the pressure the crowd on it builds.

import { describe, expect, it } from "vitest";
import { LEVELS, PRESSURE_FREE, SEED_CORES, SPACING } from "./constants";
import type { ChargeId } from "./constants";
import { harness, last } from "./harness.test";

describe("the opening train", () => {
  it("opens a level with twelve cores", () => {
    const hall = harness();
    hall.api.startLevel(1);
    expect(hall.api.snapshot().train).toHaveLength(SEED_CORES);
  });

  it("runs the opening twelve from the inlet to arc distance 308", () => {
    const hall = harness();
    hall.api.startLevel(1);
    const train = hall.api.snapshot().train;
    expect(train[0].s).toBe(308);
    expect(train[train.length - 1].s).toBe(0);
    for (let i = 1; i < train.length; i += 1) {
      expect(train[i - 1].s - train[i].s).toBeCloseTo(SPACING, 9);
    }
    expect(hall.api.snapshot().segments).toEqual([{ count: 12, hold: 0 }]);
  });

  it("counts the opening twelve against the level's quota", () => {
    const hall = harness();
    for (let level = 1; level <= LEVELS.length; level += 1) {
      hall.api.startLevel(level);
      const shot = hall.api.snapshot();
      expect(shot.quotaRemaining + SEED_CORES).toBe(LEVELS[level - 1].quota);
      expect(shot.emitted).toBe(SEED_CORES);
    }
  });
});

describe("advance under the tick", () => {
  it("rides the lead segment at the level's feed speed", () => {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.setPressure(0);
    hall.api.setQuotaRemaining(0);
    hall.api.clearTrain();
    hall.api.poseTrain([[1000, "halide", null]]);
    hall.step(60);
    expect(hall.api.snapshot().train[0].s).toBeCloseTo(1022, 3);
  });

  it("holds a paused hall exactly where the tick that paused it left it", () => {
    const hall = harness();
    hall.api.startLevel(1);
    const before = hall.api.snapshot().train[0].s;
    hall.api.pause();
    hall.step(120);
    expect(hall.api.snapshot().train[0].s).toBeCloseTo(before, 6);
  });
});

describe("the inlet", () => {
  it("places a core as soon as the tail has cleared one spacing", () => {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.setQuotaRemaining(10);
    hall.api.clearTrain();
    hall.api.poseTrain([[20, "halide", null]]);

    let emittedAt = -1;
    for (let i = 1; i <= 60; i += 1) {
      const tail = last(hall.api.snapshot().train);
      hall.step();
      const after = hall.api.snapshot();
      if (after.train.length > 1) {
        emittedAt = i;
        expect(tail!.s).toBeLessThan(SPACING);
        expect(last(after.train).s).toBe(0);
        break;
      }
      expect(after.train[0].s).toBeLessThan(SPACING);
    }
    expect(emittedAt).toBeGreaterThan(0);
  });

  it("places a core at once onto a channel carrying none", () => {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.clearTrain();
    hall.step();
    expect(hall.api.snapshot().train).toHaveLength(1);
  });

  it("stops once the quota is spent, however far the train rides", () => {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.setQuotaRemaining(0);
    hall.api.clearTrain();
    hall.api.poseTrain([[100, "halide", null]]);
    hall.step(600);
    expect(hall.api.snapshot().train).toHaveLength(1);
  });

  it("draws an emitted charge from the charges already on the channel", () => {
    const hall = harness();
    hall.api.startLevel(5);
    hall.api.clearTrain();
    // A long enough halide train that the emissions come well before the trailing
    // segment closes on it — that merge would draw the whole run out and leave the
    // channel empty, which is the other half of the rule and is checked below.
    hall.api.poseTrain(
      Array.from(
        { length: 12 },
        (_unused, index) => [2000 - index * SPACING, "halide", null] as const,
      ) as never,
    );
    hall.api.setQuotaRemaining(20);

    let placed = 0;
    for (let i = 0; i < 400 && placed < 10; i += 1) {
      const before = hall.api.snapshot().train;
      hall.step();
      const after = hall.api.snapshot().train;
      if (after.length <= before.length) continue;
      placed += 1;
      const present = new Set(before.map((core) => core.charge));
      expect(present.size).toBeGreaterThan(0);
      expect([...present]).toContain(last(after).charge);
    }
    expect(placed).toBe(10);
  });

  it("draws from the level's own set onto an empty channel", () => {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.clearTrain();
    const allowed: readonly ChargeId[] = LEVELS[0].charges;
    for (let i = 0; i < 200; i += 1) hall.step();
    for (const core of hall.api.snapshot().train) {
      expect(allowed).toContain(core.charge);
    }
  });
});

describe("pressure", () => {
  /** A hall carrying `count` cores in one segment, at a chosen pressure. */
  function crowd(count: number, pressure: number) {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.setQuotaRemaining(0);
    hall.api.clearTrain();
    hall.api.poseTrain(
      Array.from(
        { length: count },
        (_unused, index) => [3000 - index * SPACING, "halide", null] as const,
      ) as never,
    );
    hall.api.setPressure(pressure);
    return hall;
  }

  it("rises by 0.05 a second for each core above the free count", () => {
    const hall = crowd(PRESSURE_FREE + 20, 0);
    hall.step(60);
    expect(hall.api.snapshot().pressure).toBeCloseTo(1.0, 3);
  });

  it("bleeds by 2.0 a second off an uncrowded channel", () => {
    const hall = crowd(PRESSURE_FREE, 50);
    hall.step(60);
    expect(hall.api.snapshot().pressure).toBeCloseTo(48, 3);
  });

  it("never rises above 100", () => {
    const hall = crowd(100, 99.9);
    hall.step(60);
    expect(hall.api.snapshot().pressure).toBeLessThanOrEqual(100);
    expect(hall.api.snapshot().pressure).toBeGreaterThan(99.9);
  });

  it("never falls below 0", () => {
    const hall = crowd(10, 0.5);
    hall.step(60);
    expect(hall.api.snapshot().pressure).toBe(0);
  });

  it("multiplies the feed speed", () => {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.setQuotaRemaining(0);
    hall.api.clearTrain();
    hall.api.poseTrain([[1000, "halide", null]]);
    hall.api.setPressure(50);
    expect(hall.api.snapshot().feedSpeed).toBeCloseTo(33, 6);
    hall.step(60);
    // The pressure bleeds while the core rides, so the gain is the integral of a
    // feed falling from 33 to 32.57 — 32.78 units, inside the stated tolerance.
    expect(hall.api.snapshot().train[0].s - 1000).toBeCloseTo(32.78, 1);
  });
});
