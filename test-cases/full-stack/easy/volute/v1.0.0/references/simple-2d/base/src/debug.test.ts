// The debugging and automation surface: every operation it names, the snapshot it
// reports, and the two rules that make it worth resting a verdict on — a pose
// arranges the hall and decides nothing, and the hall it arranges is
// reproducible.

import { describe, expect, it } from "vitest";
import {
  CELLS,
  CHARGE_IDS,
  DEFAULT_SEED,
  LEVELS,
  LEVEL_COUNT,
  MACHINERY_DURATIONS,
  PATH_LENGTH,
  SEEDED_CORES,
  VOLUTE_DEBUG_VERSION,
} from "./constants";
import { bare, harness } from "./harness.test";

/** Every operation specs/instrumentation.md names, beside `version`. */
const OPERATIONS = [
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
    h.api.grantMachinery("bore");
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
        "pressure",
        "projectiles",
        "quotaRemaining",
        "rngState",
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
      rngState: DEFAULT_SEED,
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

  it("seeds the generator, and leaves the mute bit alone", async () => {
    const h = await harness();
    h.tap("KeyM");
    await h.step();
    expect(h.api.snapshot().muted).toBe(true);
    h.api.reset({ seed: 12345 });
    expect(h.api.snapshot().rngState).toBe(12345);
    await h.step();
    expect(h.api.snapshot().muted).toBe(true);
    h.dispose();
  });

  it("reaches the same hall from the same seed and the same calls", async () => {
    const trace = async (): Promise<string> => {
      const h = await harness();
      h.api.reset({ seed: 99 });
      h.api.start();
      await h.step(120);
      h.api.fireAt(300);
      await h.step(60);
      const shot = h.api.snapshot();
      h.dispose();
      // `simTime` is the one field outside the guarantee, and it is identical
      // here anyway because both runs stepped the same number of frames.
      return JSON.stringify(shot);
    };
    expect(await trace()).toBe(await trace());
  });

  it("reaches a different hall from a different seed", async () => {
    const opening = async (seed: number): Promise<string> => {
      const h = await harness();
      h.api.reset({ seed });
      h.api.start();
      const charges = h.api.snapshot().train.map((core) => core.charge);
      h.dispose();
      return charges.join(",");
    };
    expect(await opening(1)).not.toBe(await opening(7));
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

  it("poseTrain clamps an arc position past the intake and normalizes its arguments", async () => {
    const h = await bare();
    h.api.poseTrain([
      [9999, "not-a-charge", "not-a-mark"],
      [Number.NaN, "garnet", null],
    ]);
    const shot = h.api.snapshot();
    expect(shot.train[0].s).toBe(PATH_LENGTH);
    expect(shot.train[0].charge).toBe(CHARGE_IDS[0]);
    expect(shot.train[0].mark).toBeNull();
    expect(shot.train[1].s).toBe(0);
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

  it("setLoaded and setQueued leave the generator where it stood", async () => {
    const h = await bare();
    const before = h.api.snapshot().rngState;
    h.api.setLoaded("olivine");
    h.api.setQueued("garnet");
    const shot = h.api.snapshot();
    expect(shot.injector.loaded).toBe("olivine");
    expect(shot.injector.queued).toBe("garnet");
    expect(shot.rngState).toBe(before);
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

  it("setPressure clamps, and the feed speed follows at once", async () => {
    const h = await bare();
    h.api.setPressure(500);
    expect(h.api.snapshot().pressure).toBe(100);
    expect(h.api.snapshot().feedSpeed).toBeCloseTo(44, 6);
    h.api.setPressure(-10);
    expect(h.api.snapshot().pressure).toBe(0);
    expect(h.api.snapshot().feedSpeed).toBeCloseTo(22, 6);
    h.dispose();
  });

  it("setQuotaRemaining clamps into the level's quota and moves the cadence", async () => {
    const h = await bare();
    h.api.setQuotaRemaining(999);
    expect(h.api.snapshot().quotaRemaining).toBe(LEVELS[0].quota);
    h.api.setQuotaRemaining(-5);
    expect(h.api.snapshot().quotaRemaining).toBe(0);

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
    h.api.grantMachinery("not-a-kind");
    expect(h.api.snapshot().machinery?.kind).toBe("choke");
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
    h.api.startLevel(LEVEL_COUNT + 10);
    expect(h.api.snapshot().level).toBe(LEVEL_COUNT);
    h.dispose();
  });
});
