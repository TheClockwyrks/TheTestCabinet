// The channel as the tick drives it: what a level opens with, how a segment
// advances and merges, how the inlet feeds it, and the pressure the crowd on it
// builds.

import { describe, expect, it } from "vitest";
import {
  CATCHUP_SPEED,
  LEVELS,
  PRESSURE_FREE,
  SEEDED_CORES,
  SEEDED_HEAD_S,
  SPACING,
} from "./constants";
import { bare, harness, last, runOf } from "./harness.test";

describe("the opening train", () => {
  it("opens a level with twelve cores", async () => {
    const h = await harness();
    h.api.startLevel(1);
    expect(h.api.snapshot().train).toHaveLength(SEEDED_CORES);
    h.dispose();
  });

  it("runs the opening twelve from the inlet to arc distance 308", async () => {
    const h = await harness();
    h.api.startLevel(1);
    const train = h.api.snapshot().train;
    expect(train[0].s).toBe(SEEDED_HEAD_S);
    expect(last(train).s).toBe(0);
    for (let i = 1; i < train.length; i += 1) {
      expect(train[i - 1].s - train[i].s).toBeCloseTo(SPACING, 9);
    }
    expect(h.api.snapshot().segments).toEqual([{ count: 12, hold: 0 }]);
    h.dispose();
  });

  it("counts the opening twelve against the level's quota", async () => {
    const h = await harness();
    for (let level = 1; level <= LEVELS.length; level += 1) {
      h.api.startLevel(level);
      const shot = h.api.snapshot();
      expect(shot.quotaRemaining + SEEDED_CORES).toBe(LEVELS[level - 1].quota);
      expect(shot.emitted).toBe(SEEDED_CORES);
    }
    h.dispose();
  });
});

describe("a core's place on the channel", () => {
  it("walks an arc distance along the polyline", async () => {
    const h = await bare();
    const expected: [number, number, number][] = [
      [880, 920, 40],
      [1340, 920, 500],
      [3240, 840, 120],
      [4360, 220, 220],
      [4990, 490, 320],
    ];
    for (const [s, x, y] of expected) {
      h.api.poseTrain([[s, "halide", null]]);
      const core = h.api.snapshot().train[0];
      expect(core.x).toBeCloseTo(x, 6);
      expect(core.y).toBeCloseTo(y, 6);
    }
    h.dispose();
  });
});

describe("advance under the tick", () => {
  it("rides the lead segment at the level's feed speed", async () => {
    const h = await harness();
    h.api.startLevel(1);
    h.api.setPressure(0);
    h.api.setQuotaRemaining(0);
    h.api.clearTrain();
    h.api.poseTrain([[1000, "halide", null]]);
    await h.step(60);
    expect(h.api.snapshot().train[0].s).toBeCloseTo(1022, 3);
    h.dispose();
  });

  it("closes a trailing segment at the catch-up speed", async () => {
    const h = await bare();
    h.api.poseTrain([
      [3000, "halide", null],
      [2000, "cobalt", null],
    ]);
    const before = h.api.snapshot().train[1].s;
    await h.step(30);
    expect(h.api.snapshot().train[1].s - before).toBeCloseTo(
      CATCHUP_SPEED / 2,
      3,
    );
    h.dispose();
  });

  it("clamps a catching-up segment one spacing behind the one ahead", async () => {
    const h = await bare();
    h.api.poseTrain([
      [3000, "halide", null],
      [2900, "cobalt", null],
    ]);
    await h.step(60);
    const train = h.api.snapshot().train;
    expect(train[0].s - train[1].s).toBeCloseTo(SPACING, 6);
    h.dispose();
  });

  it("rides two merged segments as one", async () => {
    const h = await bare();
    h.api.poseTrain([
      [3000, "halide", null],
      [2900, "cobalt", null],
      [2872, "garnet", null],
    ]);
    for (let i = 0; i < 200; i += 1) {
      await h.step();
      if (h.api.snapshot().segments.length === 1) break;
    }
    expect(h.api.snapshot().segments).toEqual([{ count: 3, hold: 0 }]);
    const spread = h.api.snapshot().train;
    await h.step(30);
    const after = h.api.snapshot().train;
    // One segment, so every core gained the same distance.
    const gains = after.map((core, index) => core.s - spread[index].s);
    expect(gains[1]).toBeCloseTo(gains[0], 6);
    expect(gains[2]).toBeCloseTo(gains[0], 6);
    h.dispose();
  });
});

describe("the inlet", () => {
  it("places a core as soon as the tail has cleared one spacing", async () => {
    const h = await harness();
    h.api.startLevel(1);
    h.api.setQuotaRemaining(10);
    h.api.clearTrain();
    h.api.poseTrain([[20, "halide", null]]);

    let emittedAt = -1;
    for (let i = 1; i <= 60; i += 1) {
      const tail = last(h.api.snapshot().train);
      await h.step();
      const after = h.api.snapshot();
      if (after.train.length > 1) {
        emittedAt = i;
        expect(tail.s).toBeLessThan(SPACING);
        expect(last(after.train).s).toBe(0);
        break;
      }
      expect(after.train[0].s).toBeLessThan(SPACING);
    }
    expect(emittedAt).toBeGreaterThan(0);
    h.dispose();
  });

  it("places a core at once onto a channel carrying none", async () => {
    const h = await harness();
    h.api.startLevel(1);
    h.api.clearTrain();
    await h.step();
    expect(h.api.snapshot().train).toHaveLength(1);
    h.dispose();
  });

  it("stops once the quota is spent, however far the train rides", async () => {
    const h = await harness();
    h.api.startLevel(1);
    h.api.setQuotaRemaining(0);
    h.api.clearTrain();
    h.api.poseTrain([[100, "halide", null]]);
    await h.step(600);
    expect(h.api.snapshot().train).toHaveLength(1);
    h.dispose();
  });

  it("draws an emitted charge from the charges already on the channel", async () => {
    const h = await harness();
    h.api.startLevel(5);
    h.api.clearTrain();
    // A long enough halide train that the emissions come well before the trailing
    // segment closes on it.
    h.api.poseTrain(
      runOf(
        2000,
        Array.from({ length: 12 }, () => "halide"),
      ),
    );
    h.api.setQuotaRemaining(20);

    let placed = 0;
    for (let i = 0; i < 400 && placed < 10; i += 1) {
      const before = h.api.snapshot().train;
      await h.step();
      const after = h.api.snapshot().train;
      if (after.length <= before.length) continue;
      placed += 1;
      const present = new Set(before.map((core) => core.charge));
      expect([...present]).toContain(last(after).charge);
    }
    expect(placed).toBe(10);
    h.dispose();
  });

  it("draws from the level's own set onto an empty channel", async () => {
    const h = await harness();
    h.api.startLevel(1);
    h.api.clearTrain();
    await h.step(200);
    for (const core of h.api.snapshot().train) {
      expect(LEVELS[0].charges).toContain(core.charge);
    }
    h.dispose();
  });
});

describe("pressure", () => {
  /** A hall carrying `count` cores in one segment, at a chosen pressure. */
  async function crowd(count: number, pressure: number) {
    const h = await harness();
    h.api.startLevel(1);
    h.api.setQuotaRemaining(0);
    h.api.clearTrain();
    h.api.poseTrain(
      runOf(
        3000,
        Array.from({ length: count }, () => "halide"),
      ),
    );
    h.api.setPressure(pressure);
    return h;
  }

  it("rises by 0.05 a second for each core above the free count", async () => {
    const h = await crowd(PRESSURE_FREE + 20, 0);
    await h.step(60);
    expect(h.api.snapshot().pressure).toBeCloseTo(1.0, 3);
    h.dispose();
  });

  it("bleeds by 2.0 a second off an uncrowded channel", async () => {
    const h = await crowd(PRESSURE_FREE, 50);
    await h.step(60);
    expect(h.api.snapshot().pressure).toBeCloseTo(48, 3);
    h.dispose();
  });

  it("never rises above 100", async () => {
    const h = await crowd(100, 99.9);
    await h.step(60);
    expect(h.api.snapshot().pressure).toBeLessThanOrEqual(100);
    expect(h.api.snapshot().pressure).toBeGreaterThan(99.9);
    h.dispose();
  });

  it("never falls below 0", async () => {
    const h = await crowd(10, 0.5);
    await h.step(60);
    expect(h.api.snapshot().pressure).toBe(0);
    h.dispose();
  });

  it("multiplies the feed speed", async () => {
    const h = await bare();
    h.api.poseTrain([[1000, "halide", null]]);
    h.api.setPressure(50);
    expect(h.api.snapshot().feedSpeed).toBeCloseTo(33, 6);
    await h.step(60);
    // The pressure bleeds while the core rides, so the gain is the integral of a
    // feed falling from 33 to 32.57 — 32.78 units, inside the stated tolerance.
    expect(h.api.snapshot().train[0].s - 1000).toBeCloseTo(32.78, 1);
    h.dispose();
  });
});
