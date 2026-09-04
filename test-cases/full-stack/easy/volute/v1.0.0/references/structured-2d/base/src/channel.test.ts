// The channel as the mode drives it (specs/channel.md): what a level opens with,
// how a segment advances and merges, how the inlet feeds it, and the pressure the
// crowd on it builds.

import { describe, expect, it } from "vitest";
import {
  CATCHUP_SPEED,
  LEVELS,
  PRESSURE_FREE,
  SEEDED_CORES,
  SEEDED_HEAD_S,
  SPACING,
} from "./constants";
import type { ChargeId } from "./constants";
import type { PosedCore } from "./debug";
import {
  current,
  isolate,
  openLevel,
  poseTrain,
  run,
  useHarness,
} from "./harness";

useHarness();

describe("the opening train", () => {
  it("opens a level with twelve cores", async () => {
    const h = current();
    await openLevel(h, 1);
    expect(h.snapshot().train).toHaveLength(SEEDED_CORES);
    expect(h.engine.world.byTag("core")).toHaveLength(SEEDED_CORES);
  });

  it("runs the opening twelve from the inlet to arc distance 308", async () => {
    const h = current();
    await openLevel(h, 1);
    const train = h.snapshot().train;
    expect(train[0].s).toBe(SEEDED_HEAD_S);
    expect(train[train.length - 1].s).toBe(0);
    for (let i = 1; i < train.length; i += 1) {
      expect(train[i - 1].s - train[i].s).toBeCloseTo(SPACING, 9);
    }
    expect(h.snapshot().segments).toEqual([{ count: 12, hold: 0 }]);
  });

  it("counts the opening twelve against the level's quota", async () => {
    const h = current();
    for (let level = 1; level <= LEVELS.length; level += 1) {
      await openLevel(h, level);
      const shot = h.snapshot();
      expect(shot.quotaRemaining + SEEDED_CORES).toBe(LEVELS[level - 1].quota);
      expect(shot.emitted).toBe(SEEDED_CORES);
    }
  });
});

describe("the arc-length measure", () => {
  it("stands a core at the point its arc distance gives", async () => {
    const h = current();
    await isolate(h);
    const walk: readonly (readonly [number, number, number])[] = [
      [880, 920, 40],
      [1340, 920, 500],
      [3240, 840, 120],
      [4360, 220, 220],
      [4990, 490, 320],
    ];
    for (const [s, x, y] of walk) {
      poseTrain(h, [[s, "halide", null]]);
      const core = h.snapshot().train[0];
      expect(core.x).toBeCloseTo(x, 6);
      expect(core.y).toBeCloseTo(y, 6);
    }
  });
});

describe("advance", () => {
  it("rides the lead segment at the level's feed speed", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    await h.engine.advance(60);
    expect(h.snapshot().train[0].s).toBeCloseTo(1022, 3);
  });

  it("closes a trailing segment at the catch-up speed", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [2000, "halide", null],
      [1000, "cobalt", null],
    ]);
    await h.engine.advance(30);
    expect(h.snapshot().train[1].s).toBeCloseTo(1000 + CATCHUP_SPEED * 0.5, 3);
  });

  it("clamps a catching-up segment one spacing behind the one ahead", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [2000, "halide", null],
      [1900, "cobalt", null],
    ]);
    await h.engine.advance(90);
    const train = h.snapshot().train;
    expect(train[0].s - train[1].s).toBeCloseTo(SPACING, 6);
    expect(h.snapshot().segments).toHaveLength(1);
  });

  it("rides a merged segment as one, at the feed speed", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [2000, "halide", null],
      [1900, "cobalt", null],
    ]);
    await h.engine.advance(90);
    const joined = h.snapshot().train[1].s;
    await h.engine.advance(60);
    expect(h.snapshot().train[1].s - joined).toBeCloseTo(22, 1);
  });

  it("holds a segment through its recoil hold", async () => {
    const h = current();
    await isolate(h);
    // Three halide at the head, centred on the shot's path up the top leg, and
    // four cobalt trailing them.
    poseTrain(h, [
      ...run(400, 3, "halide"),
      ...run(400 - 3 * SPACING, 4, "cobalt"),
    ]);
    const tailBefore = h.snapshot().train[6].s;

    h.debug.setLoaded("halide");
    h.debug.setAim(270);
    h.debug.fire();
    let extracted = false;
    for (let i = 0; i < 40 && !extracted; i += 1) {
      await h.engine.advance(1);
      extracted = h.snapshot().train.length === 4;
    }
    expect(extracted).toBe(true);

    const held = h.snapshot().train[3].s;
    expect(held).toBeLessThan(tailBefore);
    await h.engine.advance(23);
    expect(h.snapshot().train[3].s).toBeCloseTo(held, 1);
  });
});

describe("the inlet", () => {
  it("places a core as soon as the tail has cleared one spacing", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.setQuotaRemaining(10);
    h.debug.clearTrain();
    poseTrain(h, [[20, "halide", null]]);

    let emittedAt = -1;
    for (let i = 1; i <= 60; i += 1) {
      const before = h.snapshot().train;
      await h.engine.advance(1);
      const after = h.snapshot();
      if (after.train.length > before.length) {
        emittedAt = i;
        expect(before[before.length - 1].s).toBeLessThan(SPACING);
        expect(after.train[after.train.length - 1].s).toBe(0);
        break;
      }
      expect(after.train[0].s).toBeLessThan(SPACING);
    }
    expect(emittedAt).toBeGreaterThan(0);
  });

  it("places a core at once onto a channel carrying none", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.clearTrain();
    await h.engine.advance(1);
    expect(h.snapshot().train).toHaveLength(1);
  });

  it("stops once the quota is spent, however far the train rides", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[100, "halide", null]]);
    await h.engine.advance(600);
    expect(h.snapshot().train).toHaveLength(1);
  });

  it("draws an emitted charge from the charges already on the channel", async () => {
    const h = current();
    await openLevel(h, 5);
    h.debug.clearTrain();
    // A long halide train, so the emissions come well before the trailing
    // segment closes on it.
    poseTrain(h, run(2000, 12, "halide"));
    h.debug.setQuotaRemaining(20);

    let placed = 0;
    for (let i = 0; i < 400 && placed < 10; i += 1) {
      const before = h.snapshot().train;
      await h.engine.advance(1);
      const after = h.snapshot().train;
      if (after.length <= before.length) continue;
      placed += 1;
      const present = new Set(before.map((core) => core.charge));
      expect([...present]).toContain(after[after.length - 1].charge);
    }
    expect(placed).toBe(10);
  });

  it("draws from the level's own set onto an empty channel", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.clearTrain();
    const allowed: readonly ChargeId[] = LEVELS[0].charges;
    await h.engine.advance(200);
    for (const core of h.snapshot().train) {
      expect(allowed).toContain(core.charge);
    }
  });
});

describe("pressure", () => {
  /** A hall carrying `count` cores in one segment, at a chosen pressure. */
  async function crowd(count: number, pressure: number): Promise<void> {
    const h = current();
    await isolate(h);
    poseTrain(
      h,
      Array.from({ length: count }, (_unused, index): PosedCore => [
        3000 - index * SPACING,
        "halide",
        null,
      ]),
    );
    h.debug.setPressure(pressure);
  }

  it("rises by 0.05 a second for each core above the free count", async () => {
    const h = current();
    await crowd(PRESSURE_FREE + 20, 0);
    await h.engine.advance(60);
    expect(h.snapshot().pressure).toBeCloseTo(1.0, 3);
  });

  it("bleeds by 2.0 a second off an uncrowded channel", async () => {
    const h = current();
    await crowd(PRESSURE_FREE, 50);
    await h.engine.advance(60);
    expect(h.snapshot().pressure).toBeCloseTo(48, 3);
  });

  it("never rises above 100", async () => {
    const h = current();
    await crowd(100, 99.9);
    await h.engine.advance(60);
    expect(h.snapshot().pressure).toBeLessThanOrEqual(100);
    expect(h.snapshot().pressure).toBeGreaterThan(99.9);
  });

  it("never falls below 0", async () => {
    const h = current();
    await crowd(10, 0.5);
    await h.engine.advance(60);
    expect(h.snapshot().pressure).toBe(0);
  });

  it("multiplies the feed speed", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    h.debug.setPressure(50);
    expect(h.snapshot().feedSpeed).toBeCloseTo(33, 6);
    await h.engine.advance(60);
    // The pressure bleeds while the core rides, so the gain is the integral of a
    // feed falling from 33 to 32.57 — 32.78 units.
    expect(h.snapshot().train[0].s - 1000).toBeCloseTo(32.78, 1);
  });
});
