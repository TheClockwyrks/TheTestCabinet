// The debugging and automation surface: every operation it names, the snapshot it
// reports, and the rule that makes it worth resting a verdict on — a pose
// arranges the hall and decides nothing.

import { describe, expect, it } from "vitest";
import {
  CELLS,
  CHARGE_IDS,
  LEVELS,
  LEVEL_COUNT,
  MACHINERY_DURATIONS,
  PATH_LENGTH,
  SCREENS,
  SEEDED_CORES,
  VOLUTE_DEBUG_VERSION,
} from "./constants";
import { bare, harness, last, type Harness } from "./harness.test";

/** Every operation specs/instrumentation.md names, beside `version`. */
const OPERATIONS = [
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

describe("the surface itself", () => {
  it("carries its version and every operation, each a function", async () => {
    const h = await harness();
    const surface = h.engine.debug as unknown as Record<string, unknown>;
    expect(surface.version).toBe(VOLUTE_DEBUG_VERSION);
    for (const name of OPERATIONS) {
      expect(typeof surface[name], name).toBe("function");
    }
    h.dispose();
  });

  it("leaves the state it was handed exactly as it was", async () => {
    const h = await harness();
    h.api.start();
    const before = h.state;
    const snapshotBefore = JSON.stringify(h.debug.snapshot(before));
    // A pose builds a new value; the one it was given is untouched, which is what
    // lets the engine hold the state by value.
    const next = h.debug.startLevel(before, 4);
    expect(next).not.toBe(before);
    expect(JSON.stringify(h.debug.snapshot(before))).toBe(snapshotBefore);
    expect(h.debug.snapshot(next).level).toBe(4);
    h.dispose();
  });

  it("sounds nothing when a pose is applied", async () => {
    const h = await bare();
    const marker = h.cues.length;
    h.api.fireAt(270);
    h.api.grantMachinery("choke");
    h.api.startLevel(2);
    expect(h.since(marker)).toEqual([]);
    h.dispose();
  });
});

describe("snapshot", () => {
  it("reports every documented field, live", async () => {
    const h = await harness();
    h.api.start();
    h.api.setPressure(40);
    h.api.grantMachinery("choke");
    h.api.fireAt(90);
    const shot = h.api.snapshot();

    expect(Object.keys(shot).sort()).toEqual(
      [
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
    expect(shot.version).toBe(VOLUTE_DEBUG_VERSION);
    expect(shot.screen).toBe("playing");
    expect(shot.emitted).toBe(LEVELS[0].quota - shot.quotaRemaining);
    expect(shot.feedSpeed).toBeCloseTo(22 * 1.4 * 0.4, 6);
    expect(shot.machinery).toEqual({ kind: "choke", remaining: 8 });
    expect(shot.injector.aim).toBe(90);
    expect(shot.projectiles[0]).toMatchObject({ angle: 90 });
    expect(Object.keys(shot.train[0]).sort()).toEqual(
      ["charge", "mark", "s", "segment", "x", "y"].sort(),
    );
    expect(Object.keys(shot.segments[0]).sort()).toEqual(["count", "hold"]);
    expect(shot.muted).toBe(false);
    expect(shot.emission).toBe(true);
    expect(shot.feed).toBe(true);
    h.dispose();
  });

  it("moves as the game is stepped", async () => {
    const h = await harness();
    h.api.start();
    const before = h.api.snapshot();
    await h.step(30);
    const after = h.api.snapshot();
    expect(after.simTime).toBeGreaterThan(before.simTime);
    expect(after.train[0].s).toBeGreaterThan(before.train[0].s);
    h.dispose();
  });

  it("numbers the segments from the lead segment back", async () => {
    const h = await bare();
    h.api.poseTrain([
      [3000, "halide", null],
      [2972, "halide", null],
      [2000, "cobalt", null],
    ]);
    const shot = h.api.snapshot();
    expect(shot.train.map((core) => core.segment)).toEqual([0, 0, 1]);
    expect(shot.segments).toEqual([
      { count: 2, hold: 0 },
      { count: 1, hold: 0 },
    ]);
    h.dispose();
  });
});

describe("reset", () => {
  it("restores every declared field to its title value", async () => {
    const h = await harness();
    h.api.start();
    h.api.setPressure(70);
    h.api.grantMachinery("choke");
    await h.step(30);
    h.api.reset();
    const shot = h.api.snapshot();
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
    expect(shot.train).toEqual([]);
    expect(shot.segments).toEqual([]);
    expect(shot.projectiles).toEqual([]);
    expect(shot.injector).toEqual({
      aim: 270,
      cooldown: 0,
      loaded: null,
      queued: null,
    });
    h.dispose();
  });

  it("leaves the mute bit alone, and clears a posed emission charge", async () => {
    const h = await harness();
    h.tap("KeyM");
    await h.step();
    expect(h.api.snapshot().muted).toBe(true);
    h.api.setNextEmitted("garnet");
    h.api.reset();
    expect(h.api.snapshot().nextEmitted).toBeNull();
    await h.step();
    expect(h.api.snapshot().muted).toBe(true);
    h.dispose();
  });
});

describe("setNextEmitted", () => {
  /** A level-5 hall carrying halide alone, with the inlet open and cores to emit. */
  async function halideHall(): Promise<Harness> {
    const h = await bare(5);
    h.api.setQuotaRemaining(5);
    h.api.setEmission(true);
    h.api.poseTrain([
      [356, "halide", null],
      [328, "halide", null],
      [300, "halide", null],
    ]);
    return h;
  }

  it("poses the charge the inlet emits next, and the emission consumes it", async () => {
    const h = await halideHall();
    h.api.setNextEmitted("garnet");
    expect(h.api.snapshot().nextEmitted).toBe("garnet");
    await h.step();
    const shot = h.api.snapshot();
    expect(last(shot.train).charge).toBe("garnet");
    expect(shot.nextEmitted).toBeNull();
    h.dispose();
  });

  it("clears the pose on null, so the inlet draws from the channel again", async () => {
    const h = await halideHall();
    h.api.setNextEmitted("garnet");
    h.api.setNextEmitted(null);
    expect(h.api.snapshot().nextEmitted).toBeNull();
    await h.step();
    expect(last(h.api.snapshot().train).charge).toBe("halide");
    h.dispose();
  });

  it("fails loudly on a charge outside the five, leaving the pose standing", async () => {
    const h = await halideHall();
    h.api.setNextEmitted("garnet");
    expect(() => h.api.setNextEmitted("quartz")).toThrow();
    expect(h.api.snapshot().nextEmitted).toBe("garnet");
    h.dispose();
  });

  it("replaces a standing pose with the later call", async () => {
    const h = await halideHall();
    h.api.setNextEmitted("garnet");
    h.api.setNextEmitted("cobalt");
    await h.step();
    expect(last(h.api.snapshot().train).charge).toBe("cobalt");
    h.dispose();
  });

  it("waits behind a held inlet", async () => {
    const h = await halideHall();
    h.api.setEmission(false);
    h.api.setNextEmitted("garnet");
    await h.step(5);
    expect(h.api.snapshot().train).toHaveLength(3);
    expect(h.api.snapshot().nextEmitted).toBe("garnet");
    h.api.setEmission(true);
    await h.step();
    expect(last(h.api.snapshot().train).charge).toBe("garnet");
    h.dispose();
  });

  it("leaves the mark cadence where the quota puts it", async () => {
    const h = await bare(1);
    h.api.setQuotaRemaining(LEVELS[0].quota - 11);
    h.api.setEmission(true);
    h.api.setNextEmitted("sulfur");
    await h.step();
    const placed = last(h.api.snapshot().train);
    expect(placed.charge).toBe("sulfur");
    expect(placed.mark).toBe("choke");
    h.dispose();
  });
});

describe("the poses", () => {
  it("start opens a fresh run on level 1", async () => {
    const h = await harness();
    h.api.startLevel(4);
    h.api.setPressure(50);
    h.api.start();
    const shot = h.api.snapshot();
    expect(shot).toMatchObject({
      screen: "playing",
      level: 1,
      score: 0,
      cells: CELLS,
      pressure: 0,
    });
    expect(shot.train).toHaveLength(SEEDED_CORES);
    h.dispose();
  });

  it("startLevel opens a level as an interlude opens it, keeping score and cells", async () => {
    const h = await bare();
    h.api.poseTrain([[1000, "halide", null]]);
    h.api.grantMachinery("choke");
    h.api.fireAt(270);
    const before = h.api.snapshot();
    h.api.startLevel(3);
    const shot = h.api.snapshot();
    expect(shot).toMatchObject({
      screen: "playing",
      level: 3,
      pressure: 0,
      chainStep: 1,
      machinery: null,
      score: before.score,
      cells: before.cells,
    });
    expect(shot.projectiles).toEqual([]);
    expect(shot.train).toHaveLength(SEEDED_CORES);
    expect(shot.quotaRemaining).toBe(LEVELS[2].quota - SEEDED_CORES);
    expect(shot.injector.loaded).not.toBeNull();
    expect(shot.injector.queued).not.toBeNull();
    h.dispose();
  });

  it("poseTrain orders by descending arc position and clears every hold", async () => {
    const h = await bare();
    h.api.poseTrain([
      [500, "cobalt", null],
      [900, "halide", "bore"],
      [700, "garnet", null],
    ]);
    const shot = h.api.snapshot();
    expect(shot.train.map((core) => core.s)).toEqual([900, 700, 500]);
    expect(shot.train[0].mark).toBe("bore");
    expect(shot.segments.every((segment) => segment.hold === 0)).toBe(true);
    h.dispose();
  });

  it("poseTrain fails loudly on an arc position past the intake, and on a name it does not know", async () => {
    const h = await bare();
    // The intake is a constant the specification fixes, so it is the argument's
    // domain and a position past it names nothing, exactly as an unknown charge
    // or mark names nothing.
    h.api.poseTrain([[PATH_LENGTH, CHARGE_IDS[0], null]]);
    expect(h.api.snapshot().train[0].s).toBe(PATH_LENGTH);

    expect(() => h.api.poseTrain([[9999, CHARGE_IDS[0], null]])).toThrow();
    expect(() => h.api.poseTrain([[100, "not-a-charge", null]])).toThrow();
    expect(() =>
      h.api.poseTrain([[100, CHARGE_IDS[0], "not-a-mark"]]),
    ).toThrow();
    expect(() =>
      h.api.poseTrain([[Number.NaN, CHARGE_IDS[0], null]]),
    ).toThrow();
    // Nothing was half-applied: the single core the legal pose left stands alone.
    expect(h.api.snapshot().train).toHaveLength(1);
    expect(h.api.snapshot().train[0].s).toBe(PATH_LENGTH);
    h.dispose();
  });

  it("poseTrain takes an empty list, and an absent one", async () => {
    const h = await bare();
    h.api.poseTrain([]);
    expect(h.api.snapshot().train).toEqual([]);
    // A caller that named no list at all empties the channel just the same.
    (h.debug.poseTrain as unknown as (state: unknown) => unknown)(h.state);
    expect(h.api.snapshot().train).toEqual([]);
    h.dispose();
  });

  it("clearTrain empties the channel without extracting or scoring", async () => {
    const h = await bare();
    h.api.poseTrain([
      [1000, "halide", null],
      [972, "halide", null],
      [944, "halide", null],
    ]);
    h.api.fireAt(270);
    const before = h.api.snapshot();
    h.api.clearTrain();
    const shot = h.api.snapshot();
    expect(shot.train).toEqual([]);
    expect(shot.projectiles).toEqual([]);
    expect(shot.score).toBe(before.score);
    expect(shot.pressure).toBe(before.pressure);
    expect(shot.level).toBe(before.level);
    h.dispose();
  });

  it("setLoaded and setQueued set their charge, and nothing else", async () => {
    const h = await bare();
    const before = h.api.snapshot();
    h.api.setLoaded("olivine");
    h.api.setQueued("garnet");
    const shot = h.api.snapshot();
    expect(shot.injector.loaded).toBe("olivine");
    expect(shot.injector.queued).toBe("garnet");
    expect(shot.injector.aim).toBe(before.injector.aim);
    expect(shot.projectiles).toEqual([]);
    h.dispose();
  });

  it("fire normalizes its angle, clears the cooldown, and draws a loaded core", async () => {
    const h = await harness();
    h.api.reset();
    // No level is open, so the injector holds nothing: the call draws one first.
    h.api.fireAt(-90);
    const shot = h.api.snapshot();
    expect(shot.injector.aim).toBe(270);
    expect(shot.projectiles).toHaveLength(1);
    expect(shot.injector.loaded).not.toBeNull();

    h.api.fireAt(45);
    expect(h.api.snapshot().projectiles).toHaveLength(2);
    h.dispose();
  });

  it("setPressure holds its fixed domain, and the feed speed follows at once", async () => {
    const h = await bare();
    h.api.setPressure(100);
    expect(h.api.snapshot().pressure).toBe(100);
    expect(h.api.snapshot().feedSpeed).toBeCloseTo(44, 6);
    h.api.setPressure(0);
    expect(h.api.snapshot().pressure).toBe(0);
    expect(h.api.snapshot().feedSpeed).toBeCloseTo(22, 6);
    // The range is fixed as a constant, so a value outside it fails rather than
    // being brought back inside.
    expect(() => h.api.setPressure(500)).toThrow();
    expect(() => h.api.setPressure(-10)).toThrow();
    expect(h.api.snapshot().pressure).toBe(0);
    h.dispose();
  });

  it("setQuotaRemaining takes the count as given and moves the cadence", async () => {
    const h = await bare();
    // The level's quota is a live figure of the run, not a domain of the
    // argument, so a count above it is applied rather than refused.
    h.api.setQuotaRemaining(999);
    expect(h.api.snapshot().quotaRemaining).toBe(999);
    expect(() => h.api.setQuotaRemaining(-5)).toThrow();
    expect(h.api.snapshot().quotaRemaining).toBe(999);

    // Wound so the next core the inlet places is the level's second mark.
    h.api.setQuotaRemaining(LEVELS[0].quota - 24 + 1);
    h.api.setEmission(true);
    h.api.clearTrain();
    await h.step();
    expect(h.api.snapshot().train[0].mark).toBe("backflow");
    h.dispose();
  });

  it("grantMachinery grants each timed kind at its full duration", async () => {
    const h = await bare();
    for (const kind of ["choke", "backflow", "sightline"] as const) {
      h.api.grantMachinery(kind);
      expect(h.api.snapshot().machinery).toEqual({
        kind,
        remaining: MACHINERY_DURATIONS[kind],
      });
    }
    // `bore` is a machinery kind but not one this grants, and a name outside
    // the three names no grant at all: both fail loudly.
    const held = h.api.snapshot().machinery;
    expect(() => h.api.grantMachinery("not-a-kind")).toThrow();
    expect(() => h.api.grantMachinery("bore")).toThrow();
    expect(h.api.snapshot().machinery).toEqual(held);
    h.dispose();
  });

  it("pause and resume move the screen and touch nothing else", async () => {
    const h = await bare();
    const before = h.api.snapshot();
    h.api.pause();
    expect(h.api.snapshot().screen).toBe("paused");
    h.api.resume();
    const after = h.api.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.train).toEqual(before.train);
    expect(after.score).toBe(before.score);
    h.dispose();
  });

  it("applies at the call whatever the screen", async () => {
    const h = await harness();
    // The title screen advances nothing, and every pose still lands.
    expect(h.api.snapshot().screen).toBe("title");
    h.api.poseTrain([[100, "halide", null]]);
    h.api.setPressure(30);
    h.api.setQuotaRemaining(5);
    expect(h.api.snapshot().train).toHaveLength(1);
    expect(h.api.snapshot().pressure).toBe(30);
    expect(h.api.snapshot().quotaRemaining).toBe(5);
    h.api.startLevel(LEVEL_COUNT);
    expect(h.api.snapshot().level).toBe(LEVEL_COUNT);
    h.dispose();
  });
});

describe("reconcile", () => {
  it("re-derives the segments the state carries from the cores as they stand", async () => {
    const h = await bare();
    h.api.poseTrain([
      [3000, "halide", null],
      [2972, "halide", null],
      [2000, "cobalt", null],
    ]);
    const before = h.api.snapshot();
    h.api.reconcile();
    const after = h.api.snapshot();
    expect(after.segments.map((entry) => entry.count)).toEqual([2, 1]);
    expect(after.segments).toEqual(before.segments);
    expect(after.train).toEqual(before.train);
    h.dispose();
  });

  it("advances nothing, and twice matches once", async () => {
    const h = await bare();
    h.api.start();
    h.api.setPressure(40);
    h.api.fireAt(90);
    await h.step(4);

    const before = h.api.snapshot();
    h.api.reconcile();
    const once = h.api.snapshot();
    h.api.reconcile();
    const twice = h.api.snapshot();

    expect(once).toEqual(before);
    expect(twice).toEqual(once);
    expect(once.simTime).toBe(before.simTime);
    expect(once.train).toEqual(before.train);
    expect(once.projectiles).toEqual(before.projectiles);
    expect(once.pressure).toBe(before.pressure);
    expect(once.chainTimer).toBe(before.chainTimer);
    expect(once.injector.cooldown).toBe(before.injector.cooldown);
    h.dispose();
  });

  it("sounds nothing and is legal on every screen", async () => {
    const h = await bare();
    const marker = h.cues.length;
    for (const screen of SCREENS) {
      h.api.setScreen(screen);
      expect(() => h.api.reconcile()).not.toThrow();
    }
    expect(h.since(marker)).toEqual([]);
    h.dispose();
  });
});
