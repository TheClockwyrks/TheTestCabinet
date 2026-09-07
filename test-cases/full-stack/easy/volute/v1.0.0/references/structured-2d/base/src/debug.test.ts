// The debug and automation surface (specs/instrumentation.md): that every
// operation is there, that a pose arranges the hall without deciding an outcome,
// that an argument outside its range is clamped rather than refused, and that a
// posed emission charge is what the inlet emits next.

import { describe, expect, it } from "vitest";
import {
  CELLS,
  CHARGE_IDS,
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
  current,
  isolate,
  openLevel,
  poseTrain,
  useHarness,
  type Harness,
} from "./harness";

useHarness();

/** Every operation `specs/instrumentation.md` names, beside `version`. */
const OPERATIONS: readonly (keyof VoluteDebug)[] = [
  "reset",
  "snapshot",
  "setScreen",
  "setLevel",
  "setScore",
  "setCells",
  "setChainStep",
  "startLevel",
  "poseTrain",
  "clearTrain",
  "setLoaded",
  "setQueued",
  "setNextEmitted",
  "setAim",
  "fire",
  "setPressure",
  "setQuotaRemaining",
  "setEmission",
  "setFeed",
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
      "nextEmitted",
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
    h.debug.setAim(-90);
    h.debug.fire();
    expect(h.snapshot().injector.aim).toBe(270);
    h.debug.setAim(725);
    h.debug.fire();
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

  it("takes `bore` as `choke`, since only the timed kinds are granted", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[1000, "halide", null]]);
    h.debug.grantMachinery("bore");
    expect(h.snapshot().machinery?.kind).toBe("choke");
    expect(h.snapshot().train).toHaveLength(1);
    expect(h.snapshot().score).toBe(0);
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
    expect(shot.nextEmitted).toBeNull();
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

  it("clears a posed emission charge", async () => {
    const h = current();
    h.debug.setNextEmitted("garnet");
    h.debug.reset();
    await h.engine.advance(1);
    expect(h.snapshot().nextEmitted).toBeNull();
  });
});

describe("setNextEmitted", () => {
  /** A level-5 hall carrying halide alone, with the inlet open and cores to emit. */
  async function halideHall(): Promise<Harness> {
    const h = current();
    await isolate(h, 5);
    h.debug.setQuotaRemaining(5);
    h.debug.setEmission(true);
    poseTrain(h, [
      [356, "halide", null],
      [328, "halide", null],
      [300, "halide", null],
    ]);
    return h;
  }

  /** The core standing at the inlet: the tail, since the train is head first. */
  function tail(shot: VoluteSnapshot): VoluteSnapshot["train"][number] {
    return shot.train[shot.train.length - 1];
  }

  it("poses the charge the inlet emits next, and the emission consumes it", async () => {
    const h = await halideHall();
    h.debug.setNextEmitted("garnet");
    expect(h.snapshot().nextEmitted).toBe("garnet");
    await h.engine.advance(1);
    const shot = h.snapshot();
    expect(tail(shot).charge).toBe("garnet");
    expect(shot.nextEmitted).toBeNull();
  });

  it("clears the pose on null, so the inlet draws from the channel again", async () => {
    const h = await halideHall();
    h.debug.setNextEmitted("garnet");
    h.debug.setNextEmitted(null);
    expect(h.snapshot().nextEmitted).toBeNull();
    await h.engine.advance(1);
    expect(tail(h.snapshot()).charge).toBe("halide");
  });

  it("takes a charge outside the five as no pose", async () => {
    const h = await halideHall();
    h.debug.setNextEmitted("garnet");
    h.debug.setNextEmitted("quartz");
    expect(h.snapshot().nextEmitted).toBeNull();
  });

  it("replaces a standing pose with the later call", async () => {
    const h = await halideHall();
    h.debug.setNextEmitted("garnet");
    h.debug.setNextEmitted("cobalt");
    await h.engine.advance(1);
    expect(tail(h.snapshot()).charge).toBe("cobalt");
  });

  it("waits behind a held inlet", async () => {
    const h = await halideHall();
    h.debug.setEmission(false);
    h.debug.setNextEmitted("garnet");
    await h.engine.advance(5);
    expect(h.snapshot().train).toHaveLength(3);
    expect(h.snapshot().nextEmitted).toBe("garnet");
    h.debug.setEmission(true);
    await h.engine.advance(1);
    expect(tail(h.snapshot()).charge).toBe("garnet");
  });

  it("stands across a level opening", async () => {
    const h = await halideHall();
    h.debug.setEmission(false);
    h.debug.setNextEmitted("garnet");
    await openLevel(h, 2);
    expect(h.snapshot().nextEmitted).toBe("garnet");
  });

  it("leaves the mark cadence where the quota puts it", async () => {
    const h = current();
    await isolate(h, 1);
    h.debug.setQuotaRemaining(LEVELS[0].quota - 11);
    h.debug.setEmission(true);
    h.debug.setNextEmitted("sulfur");
    await h.engine.advance(1);
    const placed = tail(h.snapshot());
    expect(placed.charge).toBe("sulfur");
    expect(placed.mark).toBe("choke");
  });
});

describe("startLevel", () => {
  it("opens a run from the title with the score and the cells fresh", async () => {
    const h = current();
    await openLevel(h, 4);
    h.debug.setPressure(50);
    await h.engine.advance(30);

    h.debug.setScore(0);
    h.debug.setCells(CELLS);
    h.debug.startLevel(1);
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
