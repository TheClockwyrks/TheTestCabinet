// The seven screens and the controls that move between them (specs/ui.md,
// specs/controls.md, specs/progression.md).

import { describe, expect, it } from "vitest";
import {
  CELLS,
  INTERLUDE,
  LEVELS,
  PATH_LENGTH,
  SEEDED_CORES,
  WORLDS,
} from "./constants";
import {
  current,
  differing,
  isolate,
  openLevel,
  poseTrain,
  seatAhead,
  onLowerLeg,
  useHarness,
  type Harness,
} from "./harness";

useHarness();

/** Drive one core into the intake, and report the screen that follows. */
async function loseCell(h: Harness): Promise<void> {
  h.debug.setQuotaRemaining(0);
  h.debug.clearTrain();
  poseTrain(h, [[PATH_LENGTH - 20, "halide", null]]);
  const before = h.snapshot().cells;
  for (let i = 0; i < 120; i += 1) {
    await h.engine.advance(1);
    if (h.snapshot().cells < before) return;
  }
  throw new Error("Volute: the core never reached the intake");
}

describe("the title", () => {
  it("opens the hall on its title screen", () => {
    expect(current().snapshot().screen).toBe("title");
  });

  it("starts a run on level 1 when confirm is pressed", async () => {
    const h = current();
    h.tap("Enter");
    await h.engine.advance(1);

    const shot = h.snapshot();
    expect(h.engine.world.level).toBe(WORLDS.hall);
    expect(shot.screen).toBe("playing");
    expect(shot.level).toBe(1);
    expect(shot.cells).toBe(CELLS);
    expect(shot.score).toBe(0);
    expect(shot.train).toHaveLength(SEEDED_CORES);
    expect(shot.injector.loaded).not.toBeNull();
    expect(shot.injector.queued).not.toBeNull();
  });

  it("runs no simulation on the title screen", async () => {
    const h = current();
    await h.engine.advance(120);
    expect(h.snapshot().screen).toBe("title");
    expect(h.snapshot().train).toEqual([]);
    // The frame clock runs on every screen, whatever the simulation does.
    expect(h.snapshot().simTime).toBeCloseTo(2, 3);
  });
});

describe("pausing", () => {
  it("pauses on escape and resumes on escape", async () => {
    const h = current();
    await openLevel(h, 1);
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.snapshot().screen).toBe("paused");

    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.snapshot().screen).toBe("playing");
  });

  it("draws the hall exactly as the tick that paused it left it", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - 28, "halide", null],
      [1000, "garnet", null],
    ]);
    // An extraction leaves a flash and a live particle burst playing over the
    // hall; a pause has to stop those too, not just the train.
    await seatAhead("halide");
    await h.engine.advance(1);
    h.debug.pause();
    await h.engine.advance(1);
    const held = h.pixels();
    await h.engine.advance(30);
    expect(differing(h.pixels(), held)).toBe(0);
  });

  it("holds the train exactly where the tick that paused it left it", async () => {
    const h = current();
    await openLevel(h, 1);
    await h.engine.advance(10);
    h.debug.pause();
    const before = h.snapshot().train[0].s;
    await h.engine.advance(120);
    expect(h.snapshot().train[0].s).toBeCloseTo(before, 6);
  });
});

describe("muting", () => {
  it("toggles the hall's audio on M, and reports the bit", async () => {
    const h = current();
    await openLevel(h, 1);
    expect(h.snapshot().muted).toBe(false);

    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.snapshot().muted).toBe(true);

    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.snapshot().muted).toBe(false);
  });

  it("answers mute on the title screen too", async () => {
    const h = current();
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.snapshot().muted).toBe(true);
  });
});

describe("the interludes", () => {
  it("advances the interlude's own timer and nothing else", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - 28, "halide", null],
    ]);
    await seatAhead("halide");
    expect(h.snapshot().screen).toBe("cleared");

    const before = h.snapshot().interlude;
    await h.engine.advance(30);
    expect(h.snapshot().interlude).toBeCloseTo(before - 0.5, 3);
    expect(h.snapshot().train).toEqual([]);
  });
});

describe("the endings", () => {
  it("returns a finished run to the title, with every value fresh", async () => {
    const h = current();
    await openLevel(h, 1);
    for (let spent = 1; spent <= CELLS; spent += 1) {
      await loseCell(h);
      if (spent < CELLS) await h.engine.advance(Math.ceil(INTERLUDE * 60) + 1);
    }
    expect(h.snapshot().screen).toBe("gameover");

    h.tap("Enter");
    await h.engine.advance(1);

    const shot = h.snapshot();
    expect(h.engine.world.level).toBe(WORLDS.title);
    expect(shot.screen).toBe("title");
    expect(shot.score).toBe(0);
    expect(shot.level).toBe(1);
    expect(shot.cells).toBe(CELLS);
    expect(shot.quotaRemaining).toBe(LEVELS[0].quota);
    expect(shot.injector).toEqual({
      aim: 270,
      cooldown: 0,
      loaded: null,
      queued: null,
    });
  });

  it("runs nothing on an ending until it is dismissed", async () => {
    const h = current();
    await isolate(h, 5);
    poseTrain(h, [
      [onLowerLeg(400), "halide", null],
      [onLowerLeg(400) - 28, "halide", null],
    ]);
    await seatAhead("halide");
    expect(h.snapshot().screen).toBe("victory");

    const score = h.snapshot().score;
    await h.engine.advance(300);
    expect(h.snapshot().screen).toBe("victory");
    expect(h.snapshot().score).toBe(score);
  });
});
