// The marks a level delivers, and the four machineries they grant
// (specs/machinery.md).

import { describe, expect, it } from "vitest";
import {
  BORE_RADIUS,
  LEVELS,
  MACHINERY_DURATIONS,
  MARK_INTERVAL,
  SCORE_PER_CORE,
  SPACING,
} from "./constants";
import type { MachineryKind } from "./constants";
import type { PosedCore } from "./debug";
import { sightlineEnd } from "./scenery";
import {
  current,
  isolate,
  openLevel,
  poseTrain,
  run,
  toward,
  useHarness,
} from "./harness";

useHarness();

describe("marks", () => {
  it("marks the twelfth core a level delivers, and no other of the twelve", async () => {
    const h = current();
    await openLevel(h, 1);
    const train = h.snapshot().train;
    // The seeded twelve enter head first, so the core standing at the inlet is
    // the level's twelfth.
    expect(train[train.length - 1].mark).toBe("choke");
    for (let i = 0; i < train.length - 1; i += 1) {
      expect(train[i].mark).toBeNull();
    }
  });

  /** The mark the next core level 5 delivers carries, for a chosen ordinal. */
  async function markAt(ordinal: number): Promise<MachineryKind | null> {
    const h = current();
    await openLevel(h, 5);
    h.debug.clearTrain();
    h.debug.setQuotaRemaining(LEVELS[4].quota - ordinal + 1);
    await h.engine.advance(1);
    const train = h.snapshot().train;
    return train[train.length - 1].mark;
  }

  it("cycles the marks through choke, backflow, bore, then sightline", async () => {
    expect(await markAt(MARK_INTERVAL)).toBe("choke");
    expect(await markAt(MARK_INTERVAL * 2)).toBe("backflow");
    expect(await markAt(MARK_INTERVAL * 3)).toBe("bore");
    expect(await markAt(MARK_INTERVAL * 4)).toBe("sightline");
  });

  it("leaves a core between the marks unmarked", async () => {
    expect(await markAt(MARK_INTERVAL + 1)).toBeNull();
    expect(await markAt(MARK_INTERVAL * 2 - 1)).toBeNull();
  });
});

describe("granting", () => {
  it("grants a marked core's machinery on the tick its run is drawn out", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [3980, "halide", null],
      [3952, "halide", "choke"],
      [3924, "cobalt", null],
      [1000, "garnet", null],
    ]);
    expect(h.snapshot().machinery).toBeNull();

    h.debug.setLoaded("halide");
    h.debug.setAim(toward(380, 420));
    h.debug.fire();
    for (let i = 0; i < 20; i += 1) {
      await h.engine.advance(1);
      if (h.snapshot().machinery !== null) break;
    }
    expect(h.snapshot().machinery?.kind).toBe("choke");
    expect(h.snapshot().machinery?.remaining).toBeCloseTo(
      MACHINERY_DURATIONS.choke,
      1,
    );
  });

  it("replaces the machinery already running", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    h.debug.grantMachinery("choke");
    await h.engine.advance(60);
    expect(h.snapshot().machinery?.kind).toBe("choke");

    h.debug.grantMachinery("sightline");
    expect(h.snapshot().machinery?.kind).toBe("sightline");
    expect(h.snapshot().machinery?.remaining).toBeCloseTo(
      MACHINERY_DURATIONS.sightline,
      6,
    );
  });
});

describe("choke", () => {
  it("multiplies the feed speed by 0.4", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    h.debug.grantMachinery("choke");
    expect(h.snapshot().feedSpeed).toBeCloseTo(8.8, 6);
    await h.engine.advance(60);
    expect(h.snapshot().train[0].s - 1000).toBeCloseTo(8.8, 2);
  });

  it("lapses after its run, leaving the feed as it was", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[500, "halide", null]]);
    h.debug.grantMachinery("choke");
    await h.engine.advance(481);
    expect(h.snapshot().machinery).toBeNull();

    const at = h.snapshot().train[0].s;
    await h.engine.advance(60);
    expect(h.snapshot().train[0].s - at).toBeCloseTo(22, 2);
  });
});

describe("backflow", () => {
  it("drives every core toward the inlet at 60 units a second", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, run(2000, 4, "halide"));
    h.debug.grantMachinery("backflow");
    await h.engine.advance(30);
    expect(h.snapshot().train[0].s).toBeCloseTo(1970, 3);
    expect(h.snapshot().train[3].s).toBeCloseTo(1970 - 3 * SPACING, 3);
  });

  it("packs the train against the inlet and stops the feed", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.clearTrain();
    h.debug.setQuotaRemaining(20);
    poseTrain(h, run(200, 4, "halide"));
    h.debug.grantMachinery("backflow");
    await h.engine.advance(Math.ceil(MACHINERY_DURATIONS.backflow * 60) - 2);

    const train = h.snapshot().train;
    expect(train).toHaveLength(4);
    expect(train[3].s).toBeCloseTo(0, 6);
    expect(train[0].s).toBeCloseTo(3 * SPACING, 6);
  });
});

describe("bore", () => {
  it("clears every core within its radius of the extraction point", async () => {
    const h = current();
    await isolate(h);
    // Along the straight top run: the head at (440, 40), each core 28 units of
    // arc — and so 28 units of field — behind the last.
    const cores: PosedCore[] = Array.from(
      { length: 6 },
      (_unused, i): PosedCore => [400 - i * SPACING, "halide", null],
    );
    poseTrain(h, cores);

    const head = h.snapshot().train[0];
    const before = h.snapshot().train.map((core) => ({ ...core }));
    h.mode().detonate(head.x, head.y);

    const caught = before.filter(
      (core) => Math.hypot(core.x - head.x, core.y - head.y) <= BORE_RADIUS,
    );
    expect(caught).toHaveLength(4);
    expect(h.snapshot().train).toHaveLength(before.length - caught.length);
    expect(h.snapshot().score).toBe(SCORE_PER_CORE * caught.length * 1);
    // A bore never becomes the machinery in force.
    expect(h.snapshot().machinery).toBeNull();
  });

  it("leaves the chain exactly where it stood", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, run(400, 6, "halide"));
    const head = h.snapshot().train[0];
    h.mode().detonate(head.x, head.y);
    expect(h.snapshot().chainStep).toBe(1);
    expect(h.snapshot().chainTimer).toBe(0);
  });
});

describe("sightline", () => {
  it("ends the ray at the near edge of the first core it meets", () => {
    // A core standing 200 units straight up the field from the injector, whose
    // near edge is 14 units short of its center.
    const end = sightlineEnd(270, [{ s: 380 }]);
    expect(end.x).toBeCloseTo(420, 6);
    expect(end.y).toBeCloseTo(40 + 14, 6);
  });

  it("runs the ray to the field edge when it meets no core", () => {
    const end = sightlineEnd(270, []);
    expect(end.x).toBeCloseTo(420, 6);
    expect(end.y).toBeCloseTo(0, 6);
  });

  it("draws the ray only while sightline is the machinery in force", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[380, "halide", null]]);
    await h.engine.advance(1);
    h.debug.setAim(270);
    h.debug.fire();
    await h.engine.advance(1);
    const dark = h.pixel(420, 200);

    h.debug.grantMachinery("sightline");
    await h.engine.advance(1);
    const lit = h.pixel(420, 200);
    expect(lit).not.toEqual(dark);
  });
});
