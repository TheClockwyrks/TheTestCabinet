// The shape of a run (specs/progression.md): the five levels and their figures,
// clearing, the cells a run spends at the intake, the endings, and danger.

import { describe, expect, it } from "vitest";
import {
  CELLS,
  CLEAR_SCORE,
  DANGER_S,
  INTERLUDE,
  LEVELS,
  LEVEL_COUNT,
  PATH_LENGTH,
  SEEDED_CORES,
  SPACING,
} from "./constants";
import type { PosedCore } from "./debug";
import {
  current,
  isolate,
  onLowerLeg,
  openLevel,
  poseTrain,
  seatAhead,
  useHarness,
} from "./harness";

useHarness();

/** The head of the segment the clearing extractions are posed at. */
const HEAD = onLowerLeg(400);

/** A pair of matching cores, which one seated core turns into a run of three. */
function pair(charge: string): PosedCore[] {
  return [
    [HEAD, charge, null],
    [HEAD - SPACING, charge, null],
  ];
}

describe("the level table", () => {
  it("opens each level on its own quota", async () => {
    const h = current();
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      await openLevel(h, level);
      expect(h.snapshot().quotaRemaining + SEEDED_CORES).toBe(
        LEVELS[level - 1].quota,
      );
    }
  });

  it("rides each level at its own feed speed", async () => {
    const h = current();
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      await isolate(h, level);
      poseTrain(h, [[1000, "halide", null]]);
      await h.engine.advance(60);
      expect(h.snapshot().train[0].s - 1000).toBeCloseTo(
        LEVELS[level - 1].feedSpeed,
        2,
      );
    }
  });

  it("uses only its own charges in each level", async () => {
    const h = current();
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      await openLevel(h, level);
      const allowed = LEVELS[level - 1].charges;
      for (const core of h.snapshot().train) {
        expect(allowed).toContain(core.charge);
      }
      await h.engine.advance(300);
      const after = h.snapshot();
      // Long enough that the inlet has delivered cores of its own, so what is
      // checked is the emission rule and not just the opening twelve.
      expect(after.emitted).toBeGreaterThan(SEEDED_CORES + 2);
      for (const core of after.train) {
        expect(allowed).toContain(core.charge);
      }
      const shot = h.snapshot();
      expect(allowed).toContain(shot.injector.loaded);
      expect(allowed).toContain(shot.injector.queued);
    }
  });
});

describe("clearing", () => {
  it("clears the level when the last core leaves an exhausted channel", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, pair("halide"));
    await seatAhead("halide");

    expect(h.snapshot().train).toHaveLength(0);
    expect(h.snapshot().screen).toBe("cleared");
    expect(h.snapshot().interlude).toBeCloseTo(INTERLUDE, 1);
  });

  it("adds the clear bonus on top of what the extraction paid", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, pair("halide"));
    expect(h.snapshot().score).toBe(0);
    await seatAhead("halide");
    expect(h.snapshot().score).toBe(30 + CLEAR_SCORE);
  });

  it("opens the next level after the interlude", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, pair("halide"));
    await seatAhead("halide");
    await h.engine.advance(Math.ceil(INTERLUDE * 60) + 1);

    const shot = h.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.level).toBe(2);
    expect(shot.train).toHaveLength(SEEDED_CORES);
    expect(shot.score).toBe(30 + CLEAR_SCORE);
  });

  it("wins the run on the fifth level, with no interlude", async () => {
    const h = current();
    await isolate(h, 5);
    poseTrain(h, pair("halide"));
    await seatAhead("halide");

    expect(h.snapshot().screen).toBe("victory");
    expect(h.snapshot().interlude).toBe(0);
    expect(h.snapshot().level).toBe(LEVEL_COUNT);
  });
});

describe("cells", () => {
  /** Pose one core just short of the intake and let it arrive. */
  async function arrive(h: ReturnType<typeof current>): Promise<void> {
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

  it("spends exactly one cell for a core that reaches the intake", async () => {
    const h = current();
    await openLevel(h, 1);
    await arrive(h);
    expect(h.snapshot().cells).toBe(CELLS - 1);
    expect(h.snapshot().screen).toBe("setback");
  });

  it("empties the channel and discards every shot", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.setQuotaRemaining(0);
    h.debug.clearTrain();
    poseTrain(h, [
      [PATH_LENGTH - 20, "halide", null],
      [PATH_LENGTH - 48, "halide", null],
    ]);
    h.debug.fire(180);
    for (let i = 0; i < 120; i += 1) {
      await h.engine.advance(1);
      if (h.snapshot().cells < CELLS) break;
    }
    expect(h.snapshot().train).toEqual([]);
    expect(h.snapshot().projectiles).toEqual([]);
  });

  it("puts the level's opening figures back", async () => {
    const h = current();
    await openLevel(h, 1);
    h.debug.setQuotaRemaining(0);
    h.debug.clearTrain();
    poseTrain(h, [[PATH_LENGTH - 20, "halide", null]]);
    h.debug.setPressure(60);
    h.debug.grantMachinery("choke");
    await arrive(h);

    const shot = h.snapshot();
    expect(shot.pressure).toBe(0);
    expect(shot.machinery).toBeNull();
    expect(shot.chainStep).toBe(1);
    expect(shot.quotaRemaining).toBe(LEVELS[0].quota - SEEDED_CORES);
    expect(shot.level).toBe(1);
  });

  it("restarts the same level after the interlude", async () => {
    const h = current();
    await openLevel(h, 1);
    await arrive(h);
    await h.engine.advance(Math.ceil(INTERLUDE * 60) + 1);
    expect(h.snapshot().screen).toBe("playing");
    expect(h.snapshot().level).toBe(1);
    expect(h.snapshot().train).toHaveLength(SEEDED_CORES);
  });

  it("ends the run when the last cell is spent", async () => {
    const h = current();
    await openLevel(h, 1);
    for (let spent = 1; spent <= CELLS; spent += 1) {
      await arrive(h);
      expect(h.snapshot().cells).toBe(CELLS - spent);
      if (spent < CELLS) {
        expect(h.snapshot().screen).toBe("setback");
        await h.engine.advance(Math.ceil(INTERLUDE * 60) + 1);
      }
    }
    expect(h.snapshot().screen).toBe("gameover");
    expect(h.snapshot().cells).toBe(0);
  });
});

describe("danger", () => {
  it("reads as in danger only once the head reaches the threshold", async () => {
    const h = current();
    await isolate(h);
    poseTrain(h, [[DANGER_S - 10, "halide", null]]);
    expect(h.snapshot().danger).toBe(false);
    poseTrain(h, [[DANGER_S + 10, "halide", null]]);
    expect(h.snapshot().danger).toBe(true);
  });

  it("is never in danger over an empty channel", async () => {
    const h = current();
    await isolate(h);
    expect(h.snapshot().danger).toBe(false);
  });
});
