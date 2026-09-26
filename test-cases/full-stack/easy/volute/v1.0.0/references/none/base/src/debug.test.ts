// The debug and automation surface: that every operation is there, that a
// snapshot reports the whole documented shape, that a pose applies the value it
// is given rather than declining, and that a call naming nothing the game holds a
// state for — a value outside a range the specification fixes as a constant
// included — fails loudly rather than passing quietly.

import { describe, expect, it } from "vitest";
import {
  CELLS,
  CHAIN_RESET,
  LEVELS,
  MACHINERY_KINDS,
  PATH_LENGTH,
  SCREENS,
  SEED_CORES,
  SPACING,
  VOLUTE_DEBUG_VERSION,
} from "./constants";
import { harness, last, startRun, type Harness } from "./harness.test";

const OPERATIONS = [
  "setAutoStep",
  "step",
  "reset",
  "reconcile",
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
  "setAim",
  "fire",
  "setPressure",
  "setQuotaRemaining",
  "setEmission",
  "setFeed",
  "grantMachinery",
  "pause",
  "resume",
] as const;

describe("the surface", () => {
  it("carries its version and every named operation", () => {
    const { api } = harness();
    expect(api.version).toBe(VOLUTE_DEBUG_VERSION);
    for (const name of OPERATIONS) {
      expect(typeof api[name]).toBe("function");
    }
  });

  it("reports the whole documented snapshot shape on every screen", () => {
    const { api } = harness();
    for (const screen of ["title", "playing"] as const) {
      if (screen === "playing") api.startLevel(1);
      const shot = api.snapshot();
      expect(Object.keys(shot).sort()).toEqual(
        [
          "autoStep",
          "cells",
          "chainStep",
          "chainTimer",
          "danger",
          "emission",
          "emitted",
          "feed",
          "feedSpeed",
          "injector",
          "interlude",
          "level",
          "machinery",
          "muted",
          "nextEmitted",
          "pressure",
          "projectiles",
          "quotaRemaining",
          "score",
          "screen",
          "segments",
          "simTime",
          "train",
          "version",
        ].sort(),
      );
      expect(Object.keys(shot.injector).sort()).toEqual([
        "aim",
        "cooldown",
        "loaded",
        "queued",
      ]);
      expect(shot.screen).toBe(screen);
    }
  });

  it("moves the values a step advances", () => {
    const hall = harness();
    startRun(hall);
    const before = hall.api.snapshot();
    hall.step(30);
    const after = hall.api.snapshot();
    expect(after.simTime).toBeGreaterThan(before.simTime);
    expect(after.train[0].s).toBeGreaterThan(before.train[0].s);
    expect(after.train[0].x).not.toBe(before.train[0].x);
  });

  it("numbers the segments from the lead back toward the tail", () => {
    const hall = harness();
    startRun(hall);
    hall.api.poseTrain([
      [500, "halide", null],
      [472, "halide", null],
      [300, "cobalt", null],
    ]);
    const shot = hall.api.snapshot();
    expect(shot.train.map((core) => core.segment)).toEqual([0, 0, 1]);
    expect(shot.segments.map((segment) => segment.count)).toEqual([2, 1]);
  });
});

describe("reset", () => {
  it("puts every declared field back to its title value", () => {
    const hall = harness();
    startRun(hall);
    hall.step(60);
    hall.api.setPressure(70);
    hall.api.setNextEmitted("garnet");
    hall.api.reset();
    const shot = hall.api.snapshot();
    expect(shot).toMatchObject({
      screen: "title",
      score: 0,
      level: 1,
      cells: CELLS,
      quotaRemaining: LEVELS[0].quota,
      pressure: 0,
      chainStep: 1,
      chainTimer: 0,
      machinery: null,
      interlude: 0,
      simTime: 0,
      nextEmitted: null,
    });
    expect(shot.train).toHaveLength(0);
    expect(shot.projectiles).toHaveLength(0);
    expect(shot.injector).toMatchObject({
      aim: 270,
      cooldown: 0,
      loaded: null,
      queued: null,
    });
  });

  it("leaves the mute bit alone", () => {
    const hall = harness();
    hall.press("mute");
    hall.step();
    expect(hall.api.snapshot().muted).toBe(true);
    hall.api.reset();
    hall.step();
    expect(hall.api.snapshot().muted).toBe(true);
  });
});

describe("setNextEmitted", () => {
  /** A level-5 hall carrying halide alone, with the inlet open and cores to emit. */
  function halideHall(): Harness {
    const hall = harness();
    hall.api.startLevel(5);
    hall.api.setQuotaRemaining(5);
    hall.api.clearTrain();
    hall.api.poseTrain([
      [356, "halide", null],
      [328, "halide", null],
      [300, "halide", null],
    ]);
    return hall;
  }

  it("poses the charge the inlet emits next, and the emission consumes it", () => {
    const hall = halideHall();
    hall.api.setNextEmitted("garnet");
    expect(hall.api.snapshot().nextEmitted).toBe("garnet");
    hall.step();
    const shot = hall.api.snapshot();
    expect(last(shot.train).charge).toBe("garnet");
    expect(shot.nextEmitted).toBeNull();
  });

  it("clears the pose on null, so the inlet draws from the channel again", () => {
    const hall = halideHall();
    hall.api.setNextEmitted("garnet");
    hall.api.setNextEmitted(null);
    expect(hall.api.snapshot().nextEmitted).toBeNull();
    hall.step();
    expect(last(hall.api.snapshot().train).charge).toBe("halide");
  });

  it("fails loudly on a charge outside the five, leaving the pose standing", () => {
    const hall = halideHall();
    hall.api.setNextEmitted("garnet");
    expect(() => hall.api.setNextEmitted("quartz")).toThrow();
    expect(hall.api.snapshot().nextEmitted).toBe("garnet");
  });

  it("replaces a standing pose with the later call", () => {
    const hall = halideHall();
    hall.api.setNextEmitted("garnet");
    hall.api.setNextEmitted("cobalt");
    hall.step();
    expect(last(hall.api.snapshot().train).charge).toBe("cobalt");
  });

  it("waits behind a held inlet", () => {
    const hall = halideHall();
    hall.api.setEmission(false);
    hall.api.setNextEmitted("garnet");
    hall.step(5);
    expect(hall.api.snapshot().train).toHaveLength(3);
    expect(hall.api.snapshot().nextEmitted).toBe("garnet");
    hall.api.setEmission(true);
    hall.step();
    expect(last(hall.api.snapshot().train).charge).toBe("garnet");
  });

  it("leaves the mark cadence where the quota puts it", () => {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.setQuotaRemaining(LEVELS[0].quota - 11);
    hall.api.clearTrain();
    hall.api.setNextEmitted("sulfur");
    hall.step();
    const placed = last(hall.api.snapshot().train);
    expect(placed.charge).toBe("sulfur");
    expect(placed.mark).toBe("choke");
  });
});

describe("poses", () => {
  it("orders a posed train by descending arc position", () => {
    const hall = harness();
    hall.api.poseTrain([
      [100, "halide", null],
      [900, "cobalt", "bore"],
      [500, "garnet", null],
    ]);
    const train = hall.api.snapshot().train;
    expect(train.map((core) => core.s)).toEqual([900, 500, 100]);
    expect(train[0].mark).toBe("bore");
  });

  it("keeps the list's order for two cores at the same position", () => {
    const hall = harness();
    hall.api.poseTrain([
      [400, "halide", null],
      [400, "cobalt", null],
    ]);
    expect(hall.api.snapshot().train.map((core) => core.charge)).toEqual([
      "halide",
      "cobalt",
    ]);
  });

  it("fails loudly on a posed arc position past the channel's end", () => {
    const hall = harness();
    hall.api.poseTrain([[PATH_LENGTH, "halide", null]]);
    expect(hall.api.snapshot().train[0].s).toBe(PATH_LENGTH);
    expect(() => hall.api.poseTrain([[9999, "halide", null]])).toThrow();
    // There is no floor: an insertion's shift can carry a core below zero, so a
    // negative position names a state the hall has.
    hall.api.poseTrain([[-20, "halide", null]]);
    expect(hall.api.snapshot().train[0].s).toBe(-20);
    hall.api.poseTrain([[PATH_LENGTH, "halide", null]]);
    // Nothing was half-applied: the train the last legal pose left still stands.
    expect(hall.api.snapshot().train[0].s).toBe(PATH_LENGTH);
  });

  it("fails loudly on a charge or a mark it does not know", () => {
    const hall = harness();
    expect(() => hall.api.poseTrain([[100, "quartz", null]])).toThrow();
    expect(() => hall.api.poseTrain([[100, "halide", "spanner"]])).toThrow();
    expect(() =>
      hall.api.poseTrain([["here" as unknown as number, "halide", null]]),
    ).toThrow();
    expect(hall.api.snapshot().train).toEqual([]);
    hall.api.poseTrain([[100, "halide", null]]);
    const core = hall.api.snapshot().train[0];
    expect(core.charge).toBe("halide");
    expect(core.mark).toBeNull();
  });

  it("clears every recoil hold, so a posed train advances at once", () => {
    const hall = harness();
    startRun(hall);
    hall.api.poseTrain([[1000, "halide", null]]);
    expect(hall.api.snapshot().segments[0].hold).toBe(0);
    hall.step();
    expect(hall.api.snapshot().train[0].s).toBeGreaterThan(1000);
  });

  it("clears the channel and the projectiles, and nothing else", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setPressure(30);
    hall.api.setAim(90);
    hall.api.fire();
    const score = hall.api.snapshot().score;
    hall.api.clearTrain();
    const shot = hall.api.snapshot();
    expect(shot.train).toHaveLength(0);
    expect(shot.projectiles).toHaveLength(0);
    expect(shot.pressure).toBe(30);
    expect(shot.score).toBe(score);
    expect(shot.cells).toBe(CELLS);
  });

  it("holds the pressure to its fixed domain, and takes the quota as given", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setPressure(100);
    expect(hall.api.snapshot().pressure).toBe(100);
    // The range is fixed as a constant, so it is the argument's domain and a
    // value outside it fails rather than being brought back inside.
    expect(() => hall.api.setPressure(500)).toThrow();
    expect(() => hall.api.setPressure(-5)).toThrow();
    expect(hall.api.snapshot().pressure).toBe(100);
    // The level's quota is a live figure of the run, not a domain of the
    // argument, so a count above it is applied rather than refused.
    hall.api.setQuotaRemaining(9999);
    expect(hall.api.snapshot().quotaRemaining).toBe(9999);
    hall.api.setQuotaRemaining(LEVELS[0].quota);
    expect(hall.api.snapshot().quotaRemaining).toBe(LEVELS[0].quota);
  });

  it("moves the mark cadence with the quota", () => {
    const hall = harness();
    hall.api.startLevel(1);
    hall.api.setQuotaRemaining(LEVELS[0].quota - 11);
    hall.api.clearTrain();
    hall.step();
    expect(last(hall.api.snapshot().train).mark).toBe("choke");
  });

  it("sets the loaded and queued charges, and nothing else", () => {
    const hall = harness();
    startRun(hall);
    const before = hall.api.snapshot();
    hall.api.setLoaded("olivine");
    hall.api.setQueued("garnet");
    const shot = hall.api.snapshot();
    expect(shot.injector.loaded).toBe("olivine");
    expect(shot.injector.queued).toBe("garnet");
    expect(shot.injector.aim).toBe(before.injector.aim);
    expect(shot.projectiles).toHaveLength(0);
    expect(shot.train).toEqual(before.train);
  });

  it("always launches, whatever the cooldown", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setAim(30);
    hall.api.fire();
    hall.api.setAim(60);
    hall.api.fire();
    const shot = hall.api.snapshot();
    expect(shot.projectiles).toHaveLength(2);
    expect(shot.injector.aim).toBe(60);
  });

  it("draws a charge for an injector holding none", () => {
    const hall = harness();
    expect(hall.api.snapshot().injector.loaded).toBeNull();
    hall.api.setAim(0);
    hall.api.fire();
    expect(hall.api.snapshot().projectiles[0].charge).toBeTruthy();
    expect(hall.api.snapshot().injector.loaded).toBeTruthy();
  });

  it("normalizes a fire angle into a full turn", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setAim(-90);
    hall.api.fire();
    expect(hall.api.snapshot().injector.aim).toBe(270);
    hall.api.setAim(725);
    hall.api.fire();
    expect(hall.api.snapshot().injector.aim).toBe(5);
  });

  it("grants each of the timed kinds at its full duration", () => {
    const hall = harness();
    startRun(hall);
    for (const kind of MACHINERY_KINDS) {
      if (kind === "bore") continue;
      hall.api.grantMachinery(kind);
      expect(hall.api.snapshot().machinery?.kind).toBe(kind);
    }
  });

  it("pauses and resumes whatever the screen", () => {
    const hall = harness();
    hall.api.pause();
    expect(hall.api.snapshot().screen).toBe("paused");
    hall.api.resume();
    expect(hall.api.snapshot().screen).toBe("playing");
  });

  it("opens a run from the title from single-field poses", () => {
    const hall = harness();
    startRun(hall);
    const shot = hall.api.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.level).toBe(1);
    expect(shot.score).toBe(0);
    expect(shot.cells).toBe(CELLS);
    expect(shot.train).toHaveLength(SEED_CORES);
    expect(shot.injector.loaded).not.toBeNull();
    expect(shot.injector.queued).not.toBeNull();
  });

  it("keeps the score and the cells across a level opened directly", () => {
    const hall = harness();
    startRun(hall);
    hall.api.startLevel(4);
    const shot = hall.api.snapshot();
    expect(shot.level).toBe(4);
    expect(shot.cells).toBe(CELLS);
    expect(shot.pressure).toBe(0);
    expect(shot.chainStep).toBe(1);
    expect(shot.machinery).toBeNull();
    expect(shot.projectiles).toHaveLength(0);
  });
});

describe("the single-field poses", () => {
  it("sets a screen without opening a level", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setScreen("gameover");
    const shot = hall.api.snapshot();
    expect(shot.screen).toBe("gameover");
    expect(shot.train.length).toBe(SEED_CORES);
    expect(shot.interlude).toBe(0);
    expect(() => hall.api.setScreen("nowhere")).toThrow();
    expect(hall.api.snapshot().screen).toBe("gameover");
  });

  it("sets the level, and the feed speed follows it", () => {
    const hall = harness();
    startRun(hall);
    const opened = hall.api.snapshot();
    hall.api.setLevel(5);
    const shot = hall.api.snapshot();
    expect(shot.level).toBe(5);
    expect(shot.feedSpeed).toBeGreaterThan(opened.feedSpeed);
    expect(shot.train).toHaveLength(opened.train.length);
    expect(() => hall.api.setLevel(99)).toThrow();
    expect(() => hall.api.setLevel(0)).toThrow();
    expect(hall.api.snapshot().level).toBe(5);
  });

  it("sets the score and the cells, and ends no run", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setScore(1234);
    hall.api.setCells(1);
    let shot = hall.api.snapshot();
    expect(shot.score).toBe(1234);
    expect(shot.cells).toBe(1);
    expect(shot.screen).toBe("playing");
    hall.api.setCells(0);
    shot = hall.api.snapshot();
    expect(shot.cells).toBe(0);
    expect(shot.screen).toBe("playing");
    expect(() => hall.api.setCells(99)).toThrow();
    expect(() => hall.api.setScore(-5)).toThrow();
    shot = hall.api.snapshot();
    expect(shot.cells).toBe(0);
    expect(shot.score).toBe(1234);
  });

  it("sets the chain step and restarts the window that resets it", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setChainStep(4);
    const shot = hall.api.snapshot();
    expect(shot.chainStep).toBe(4);
    expect(shot.chainTimer).toBe(CHAIN_RESET);
    expect(() => hall.api.setChainStep(0)).toThrow();
    expect(hall.api.snapshot().chainStep).toBe(4);
  });

  it("sets the aim and releases nothing", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setAim(-90);
    const shot = hall.api.snapshot();
    expect(shot.injector.aim).toBe(270);
    expect(shot.projectiles).toHaveLength(0);
    expect(shot.injector.cooldown).toBe(0);
  });

  it("holds the inlet without spending the quota", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setEmission(false);
    hall.api.clearTrain();
    const before = hall.api.snapshot();
    hall.step(120);
    const after = hall.api.snapshot();
    expect(after.emission).toBe(false);
    expect(after.train).toHaveLength(0);
    expect(after.quotaRemaining).toBe(before.quotaRemaining);
    // An unexhausted quota, so the emptied channel is not a cleared level.
    expect(after.screen).toBe("playing");
    hall.api.setEmission(true);
    hall.step();
    expect(hall.api.snapshot().train).toHaveLength(1);
  });

  it("holds the train where it stands while everything else runs", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setEmission(false);
    hall.api.setFeed(false);
    hall.api.setPressure(0);
    hall.api.clearTrain();
    hall.api.poseTrain([[1000, "halide", null]]);
    hall.api.setAim(90);
    hall.api.fire();
    const before = hall.api.snapshot();
    hall.step(10);
    const after = hall.api.snapshot();
    expect(after.feed).toBe(false);
    expect(after.train[0].s).toBe(1000);
    // The projectile still flew, and simulated time still ran.
    expect(after.projectiles[0].y).toBeGreaterThan(before.projectiles[0].y);
    expect(after.simTime).toBeGreaterThan(before.simTime);
    hall.api.setFeed(true);
    hall.step();
    expect(hall.api.snapshot().train[0].s).toBeGreaterThan(1000);
  });

  it("leaves both gates and the clock alone across a reset", () => {
    const hall = harness();
    hall.api.setEmission(false);
    hall.api.setFeed(false);
    hall.api.reset();
    const shot = hall.api.snapshot();
    expect(shot.emission).toBe(false);
    expect(shot.feed).toBe(false);
    expect(shot.screen).toBe("title");
  });
});

describe("reconcile", () => {
  it("re-derives the kept segments from the cores as they stand", () => {
    const hall = harness();
    startRun(hall);
    hall.api.poseTrain([
      [1000, "halide", null],
      [1000 - SPACING, "halide", null],
      [200, "halide", null],
    ]);
    const before = hall.api.snapshot();
    hall.api.reconcile();
    const after = hall.api.snapshot();
    // Two segments: the spaced pair, then the core standing apart.
    expect(after.segments.map((entry) => entry.count)).toEqual([2, 1]);
    expect(after.segments).toEqual(before.segments);
  });

  it("advances nothing, and twice matches once", () => {
    const hall = harness();
    startRun(hall);
    hall.api.setPressure(40);
    hall.api.setAim(90);
    hall.api.fire();
    hall.step();

    const before = hall.api.snapshot();
    hall.api.reconcile();
    const once = hall.api.snapshot();
    hall.api.reconcile();
    const twice = hall.api.snapshot();

    expect(once).toEqual(before);
    expect(twice).toEqual(once);
    expect(once.simTime).toBe(before.simTime);
    expect(once.train).toEqual(before.train);
    expect(once.projectiles).toEqual(before.projectiles);
    expect(once.pressure).toBe(before.pressure);
    expect(once.chainTimer).toBe(before.chainTimer);
    expect(once.injector.cooldown).toBe(before.injector.cooldown);
  });

  it("is legal on every screen", () => {
    const hall = harness();
    for (const screen of SCREENS) {
      hall.api.setScreen(screen);
      expect(() => hall.api.reconcile()).not.toThrow();
    }
  });
});
