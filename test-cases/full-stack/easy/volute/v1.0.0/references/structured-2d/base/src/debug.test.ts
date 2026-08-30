// The debug and automation surface (specs/instrumentation.md): that every
// operation is there, that a pose arranges the hall without deciding an outcome,
// that an argument outside its range is clamped rather than refused, and that the
// same seed with the same calls reaches the same state every time.

import { describe, expect, it } from "vitest";
import {
  CELLS,
  CHARGE_IDS,
  DEFAULT_SEED,
  LEVELS,
  LEVEL_COUNT,
  MACHINERY_DURATIONS,
  PATH_LENGTH,
  PRESSURE_MAX,
  SEEDED_CORES,
  SEEDED_HEAD_S,
  VOLUTE_DEBUG_VERSION,
} from "./constants";
import type { VoluteDebug, VoluteSnapshot } from "./debug";
import {
  createHarness,
  current,
  isolate,
  openLevel,
  poseTrain,
  useHarness,
} from "./harness";

useHarness();

/** Every operation `specs/instrumentation.md` names, beside `version`. */
const OPERATIONS: readonly (keyof VoluteDebug)[] = [
  "reset",
  "snapshot",
  "start",
  "startLevel",
  "poseTrain",
  "clearTrain",
  "setLoaded",
  "setQueued",
  "fire",
  "setPressure",
  "setQuotaRemaining",
  "grantMachinery",
  "pause",
  "resume",
];

describe("the surface", () => {
  it("carries its version and every operation as a function", () => {
    const debug = current().debug;
    expect(debug.version).toBe(VOLUTE_DEBUG_VERSION);
    for (const name of OPERATIONS) {
      expect(typeof debug[name]).toBe("function");
    }
  });

  it("reports the whole documented snapshot shape, whatever the screen", async () => {
    const h = current();
    const fields: readonly (keyof VoluteSnapshot)[] = [
      "version",
      "screen",
      "score",
      "level",
      "cells",
      "quotaRemaining",
      "emitted",
      "pressure",
      "feedSpeed",
      "chainStep",
      "chainTimer",
      "interlude",
      "danger",
      "train",
      "segments",
      "injector",
      "projectiles",
      "machinery",
      "muted",
      "simTime",
      "rngState",
    ];
    for (const shot of [h.snapshot()]) {
      for (const field of fields) expect(shot).toHaveProperty(field);
    }

    await openLevel(h, 1);
    const shot = h.snapshot();
    for (const field of fields) expect(shot).toHaveProperty(field);
    expect(shot.train[0]).toEqual(
      expect.objectContaining({
        s: expect.any(Number),
        x: expect.any(Number),
        y: expect.any(Number),
        charge: expect.any(String),
        segment: expect.any(Number),
      }),
    );
    expect(shot.segments[0]).toEqual({
      count: expect.any(Number),
      hold: expect.any(Number),
    });
  });

  it("moves what it reports as the game is stepped", async () => {
    const h = current();
    await openLevel(h, 1);
    const before = h.snapshot();
    await h.engine.advance(30);
    const after = h.snapshot();
    expect(after.train[0].s).toBeGreaterThan(before.train[0].s);
    expect(after.simTime).toBeGreaterThan(before.simTime);
  });
});

describe("a pose decides nothing", () => {
  it("leaves a posed run of three standing, and the score at 0", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [100, "halide", null],
      [128, "halide", null],
      [156, "halide", null],
    ]);
    await h.engine.advance(60);
    expect(h.snapshot().train).toHaveLength(3);
    expect(h.snapshot().score).toBe(0);
  });

  it("orders a posed train by descending arc position", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [100, "halide", null],
      [900, "cobalt", null],
      [500, "garnet", null],
    ]);
    expect(h.snapshot().train.map((core) => core.s)).toEqual([900, 500, 100]);
    expect(h.snapshot().train.map((core) => core.charge)).toEqual([
      "cobalt",
      "garnet",
      "halide",
    ]);
  });

  it("clears every recoil hold, so a posed train advances at once", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    expect(h.snapshot().segments).toEqual([{ count: 1, hold: 0 }]);
    await h.engine.advance(1);
    expect(h.snapshot().train[0].s).toBeGreaterThan(1000);
  });

  it("takes cores off the channel without a removal", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.setPressure(40);
    h.debug.setQuotaRemaining(5);
    h.debug.clearTrain();
    const shot = h.snapshot();
    expect(shot.train).toEqual([]);
    expect(shot.projectiles).toEqual([]);
    expect(shot.pressure).toBe(40);
    expect(shot.quotaRemaining).toBe(5);
    expect(shot.score).toBe(0);
  });
});

describe("clamping", () => {
  it("clamps a level outside the table", async () => {
    const h = current();
    await openLevel(h, 0);
    expect(h.snapshot().level).toBe(1);
    await openLevel(h, 99);
    expect(h.snapshot().level).toBe(LEVEL_COUNT);
  });

  it("clamps the pressure to its range", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.setPressure(-50);
    expect(h.snapshot().pressure).toBe(0);
    h.debug.setPressure(500);
    expect(h.snapshot().pressure).toBe(PRESSURE_MAX);
  });

  it("clamps the quota to the level's own", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.setQuotaRemaining(-4);
    expect(h.snapshot().quotaRemaining).toBe(0);
    h.debug.setQuotaRemaining(9999);
    expect(h.snapshot().quotaRemaining).toBe(LEVELS[0].quota);
  });

  it("clamps a posed arc position to the intake", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[99999, "halide", null]]);
    expect(h.snapshot().train[0].s).toBe(PATH_LENGTH);
  });

  it("normalizes an aim outside a turn", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1300, "halide", null]]);
    h.debug.fire(-90);
    expect(h.snapshot().injector.aim).toBe(270);
    h.debug.fire(725);
    expect(h.snapshot().injector.aim).toBe(5);
  });

  it("falls back for a charge or a mark it does not know", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "quartz", "flywheel"]]);
    expect(h.snapshot().train[0].charge).toBe(CHARGE_IDS[0]);
    expect(h.snapshot().train[0].mark).toBeNull();
    h.debug.setLoaded("quartz");
    expect(h.snapshot().injector.loaded).toBe(CHARGE_IDS[0]);
  });

  it("grants a kind it does not know as the first of the four", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    h.debug.grantMachinery("flywheel");
    expect(h.snapshot().machinery?.kind).toBe("choke");
    expect(h.snapshot().machinery?.remaining).toBe(MACHINERY_DURATIONS.choke);
  });

  it("removes nothing when a bore is granted over an empty channel", async () => {
    const h = current();
    await isolate(h);
    h.debug.grantMachinery("bore");
    expect(h.snapshot().train).toEqual([]);
    expect(h.snapshot().score).toBe(0);
    expect(h.snapshot().machinery).toBeNull();
  });
});

describe("reset", () => {
  it("puts every declared field back to its title value", async () => {
    const h = current();
    await openLevel(h, 3);
    h.debug.setPressure(70);
    h.debug.grantMachinery("choke");
    await h.engine.advance(30);

    h.debug.reset();
    await h.engine.advance(1);

    const shot = h.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.score).toBe(0);
    expect(shot.level).toBe(1);
    expect(shot.cells).toBe(CELLS);
    expect(shot.quotaRemaining).toBe(LEVELS[0].quota);
    expect(shot.pressure).toBe(0);
    expect(shot.chainStep).toBe(1);
    expect(shot.machinery).toBeNull();
    expect(shot.train).toEqual([]);
    expect(shot.projectiles).toEqual([]);
    expect(shot.interlude).toBe(0);
    expect(shot.injector.aim).toBe(270);
    expect(shot.simTime).toBeCloseTo(1 / 60, 6);
    expect(shot.rngState).toBe(DEFAULT_SEED);
  });

  it("leaves the mute bit alone, since the runtime owns it", async () => {
    const h = current();
    await openLevel(h, 1);
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.snapshot().muted).toBe(true);

    h.debug.reset();
    await h.engine.advance(1);
    expect(h.snapshot().muted).toBe(true);
  });

  it("seeds the generator from the seed it is given", async () => {
    const h = current();
    h.debug.reset({ seed: 7 });
    await h.engine.advance(1);
    expect(h.snapshot().rngState).toBe(7);
  });
});

describe("determinism", () => {
  /** The train and the injector a seeded run reaches after a fixed drive. */
  async function drive(seed: number): Promise<VoluteSnapshot> {
    const h = await createHarness();
    try {
      h.debug.reset({ seed });
      await h.engine.advance(1);
      h.debug.start();
      await h.engine.advance(1);
      h.debug.fire(300);
      await h.engine.advance(240);
      return h.snapshot();
    } finally {
      h.dispose();
    }
  }

  it("reaches the same state from the same seed and the same calls", async () => {
    const first = await drive(11);
    const second = await drive(11);
    expect(second.train).toEqual(first.train);
    expect(second.injector).toEqual(first.injector);
    expect(second.score).toBe(first.score);
    expect(second.rngState).toBe(first.rngState);
  });

  it("reaches a different opening train from a different seed", async () => {
    const first = await drive(11);
    const other = await drive(12);
    expect(other.train.map((core) => core.charge)).not.toEqual(
      first.train.map((core) => core.charge),
    );
  });
});

describe("start and startLevel", () => {
  it("opens a run from the title with the score and the cells fresh", async () => {
    const h = current();
    await openLevel(h, 4);
    h.debug.setPressure(50);
    await h.engine.advance(30);

    h.debug.start();
    await h.engine.advance(1);
    const shot = h.snapshot();
    expect(shot.level).toBe(1);
    expect(shot.score).toBe(0);
    expect(shot.cells).toBe(CELLS);
    expect(shot.pressure).toBe(0);
    expect(shot.train).toHaveLength(SEEDED_CORES);
    // One frame of the level's own feed has run since it opened.
    expect(shot.train[0].s).toBeCloseTo(SEEDED_HEAD_S + 22 / 60, 6);
  });

  it("keeps the score and the cells across a level opened from the surface", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    h.debug.grantMachinery("choke");

    await openLevel(h, 3);
    const shot = h.snapshot();
    expect(shot.level).toBe(3);
    expect(shot.cells).toBe(CELLS);
    expect(shot.machinery).toBeNull();
    expect(shot.pressure).toBe(0);
    expect(shot.chainStep).toBe(1);
    expect(shot.train).toHaveLength(SEEDED_CORES);
  });

  it("pauses and resumes without touching anything else", async () => {
    const h = current();
    await openLevel(h, 1);
    const before = h.snapshot();
    h.debug.pause();
    expect(h.snapshot().screen).toBe("paused");
    expect(h.snapshot().train).toEqual(before.train);
    h.debug.resume();
    expect(h.snapshot().screen).toBe("playing");
  });
});
