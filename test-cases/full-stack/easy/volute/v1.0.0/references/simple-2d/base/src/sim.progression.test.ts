// The shape of a run: the five levels, clearing, cells, the endings, danger, and
// the screens and controls around them.

import { describe, expect, it } from "vitest";
import {
  BINDINGS,
  CELLS,
  CLEAR_SCORE,
  DANGER_S,
  INTAKE_S,
  INTERLUDE,
  LEVELS,
  SEEDED_CORES,
  SPACING,
} from "./constants";
import {
  bare,
  harness,
  last,
  seatShot,
  topLegS,
  type Harness,
} from "./harness.test";

/** Seat the third core of a matching run, so the run leaves the channel. */
async function extractThree(h: Harness): Promise<void> {
  const head = topLegS(430);
  await seatShot(
    h,
    [
      [head, "halide", null],
      [head - SPACING, "halide", null],
    ],
    "halide",
  );
}

describe("the level table", () => {
  it("opens each level on its own quota", async () => {
    const h = await harness();
    LEVELS.forEach((level, index) => {
      h.api.startLevel(index + 1);
      expect(h.api.snapshot().quotaRemaining + SEEDED_CORES).toBe(level.quota);
    });
    h.dispose();
  });

  it("rides each level at its own feed speed", async () => {
    for (let index = 0; index < LEVELS.length; index += 1) {
      const h = await bare(index + 1);
      h.api.poseTrain([[1000, "halide", null]]);
      await h.step(60);
      expect(h.api.snapshot().train[0].s - 1000).toBeCloseTo(
        LEVELS[index].feedSpeed,
        1,
      );
      h.dispose();
    }
  });

  it("uses only its own charges", async () => {
    for (let index = 0; index < LEVELS.length; index += 1) {
      const h = await harness();
      h.api.reset({ seed: index + 7 });
      h.api.startLevel(index + 1);
      // The twelve a level opens with are drawn from the level's own set.
      const seen = new Set(h.api.snapshot().train.map((core) => core.charge));
      // Then twenty emissions onto an emptied channel, which is the other half
      // of the rule: with nothing standing on it the draw falls back to the
      // level's set as well. Emptying between each is what makes the inlet place
      // one on the very next tick.
      for (let i = 0; i < 20; i += 1) {
        h.api.clearTrain();
        await h.step();
        seen.add(last(h.api.snapshot().train).charge);
      }
      expect(seen.size).toBeGreaterThan(1);
      for (const charge of seen)
        expect(LEVELS[index].charges).toContain(charge);
      h.dispose();
    }
  });

  it("clamps a level outside the table into it", async () => {
    const h = await harness();
    h.api.startLevel(99);
    expect(h.api.snapshot().level).toBe(LEVELS.length);
    h.api.startLevel(-3);
    expect(h.api.snapshot().level).toBe(1);
    h.dispose();
  });
});

describe("clearing a level", () => {
  it("clears the moment the quota is spent and the last core leaves", async () => {
    const h = await bare();
    await extractThree(h);
    const after = h.api.snapshot();
    expect(after.train).toHaveLength(0);
    expect(after.screen).toBe("cleared");
    expect(after.interlude).toBeCloseTo(INTERLUDE, 6);
    expect(h.cues.map((play) => play.cue)).toContain("level-clear");
    h.dispose();
  });

  it("adds the clear bonus on top of what the extraction paid", async () => {
    const h = await bare();
    const before = h.api.snapshot().score;
    await extractThree(h);
    expect(h.api.snapshot().score - before).toBe(30 + CLEAR_SCORE);
    h.dispose();
  });

  it("opens the next level once the interlude has run", async () => {
    const h = await bare();
    await extractThree(h);
    await h.step(121);
    const after = h.api.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.level).toBe(2);
    expect(after.train).toHaveLength(SEEDED_CORES);
    h.dispose();
  });

  it("wins the run on the fifth level, with no interlude", async () => {
    const h = await bare(5);
    await extractThree(h);
    const after = h.api.snapshot();
    expect(after.screen).toBe("victory");
    expect(after.interlude).toBe(0);
    await h.step(600);
    expect(h.api.snapshot().screen).toBe("victory");
    h.dispose();
  });
});

describe("cells", () => {
  it("spends exactly one cell when a core reaches the intake", async () => {
    const h = await bare();
    h.api.poseTrain([[INTAKE_S - 20, "halide", null]]);
    for (let i = 0; i < 200; i += 1) {
      await h.step();
      if (h.api.snapshot().cells < CELLS) break;
    }
    const after = h.api.snapshot();
    expect(after.cells).toBe(CELLS - 1);
    expect(after.screen).toBe("setback");
    const played = h.cues.map((play) => play.cue);
    expect(played).toContain("intake");
    expect(played).toContain("cell-lost");
    h.dispose();
  });

  it("empties the channel and discards every projectile", async () => {
    const h = await bare();
    h.api.poseTrain([
      [INTAKE_S, "halide", null],
      [INTAKE_S - 28, "halide", null],
    ]);
    h.api.fire(270);
    await h.step(2);
    const after = h.api.snapshot();
    expect(after.cells).toBe(CELLS - 1);
    expect(after.train).toHaveLength(0);
    expect(after.projectiles).toHaveLength(0);
    h.dispose();
  });

  it("puts the level's opening figures back", async () => {
    const h = await bare();
    h.api.setPressure(80);
    h.api.grantMachinery("choke");
    h.api.setQuotaRemaining(20);
    h.api.poseTrain([[INTAKE_S, "halide", null]]);
    await h.step();
    const after = h.api.snapshot();
    expect(after.pressure).toBe(0);
    expect(after.machinery).toBeNull();
    expect(after.chainStep).toBe(1);
    expect(after.quotaRemaining).toBe(LEVELS[0].quota - SEEDED_CORES);
    h.dispose();
  });

  it("restarts the same level after the interlude", async () => {
    const h = await bare();
    h.api.poseTrain([[INTAKE_S, "halide", null]]);
    await h.step();
    expect(h.api.snapshot().screen).toBe("setback");
    await h.step(121);
    const after = h.api.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.level).toBe(1);
    expect(after.train).toHaveLength(SEEDED_CORES);
    h.dispose();
  });

  it("ends the run when the third cell goes", async () => {
    const h = await bare();
    for (let spend = 0; spend < CELLS; spend += 1) {
      h.api.resume();
      h.api.setQuotaRemaining(0);
      h.api.poseTrain([[INTAKE_S, "halide", null]]);
      await h.step();
      if (spend < CELLS - 1) await h.step(121);
    }
    const after = h.api.snapshot();
    expect(after.cells).toBe(0);
    expect(after.screen).toBe("gameover");
    await h.step(600);
    expect(h.api.snapshot().screen).toBe("gameover");
    h.dispose();
  });

  it("spends one cell at most on a tick", async () => {
    const h = await bare();
    h.api.poseTrain([
      [INTAKE_S, "halide", null],
      [INTAKE_S - 28, "halide", null],
    ]);
    await h.step();
    expect(h.api.snapshot().cells).toBe(CELLS - 1);
    h.dispose();
  });
});

describe("danger", () => {
  it("reads as in danger while the head stands at or past the threshold", async () => {
    const h = await bare();
    h.api.poseTrain([[DANGER_S - 10, "halide", null]]);
    expect(h.api.snapshot().danger).toBe(false);
    h.api.poseTrain([[DANGER_S + 10, "halide", null]]);
    expect(h.api.snapshot().danger).toBe(true);
    h.dispose();
  });

  it("is never in danger on an empty channel", async () => {
    const h = await bare();
    h.api.clearTrain();
    expect(h.api.snapshot().danger).toBe(false);
    h.dispose();
  });
});

describe("the screens", () => {
  it("opens on the title", async () => {
    const h = await harness();
    expect(h.api.snapshot().screen).toBe("title");
    await h.step(120);
    expect(h.api.snapshot().screen).toBe("title");
    h.dispose();
  });

  it("starts a run on the confirm control", async () => {
    const h = await harness();
    h.tap(BINDINGS.confirm[0]);
    await h.step();
    const after = h.api.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.level).toBe(1);
    expect(after.cells).toBe(CELLS);
    expect(after.score).toBe(0);
    expect(after.train).toHaveLength(SEEDED_CORES);
    h.dispose();
  });

  it("pauses and resumes on the pause control", async () => {
    const h = await harness();
    h.tap(BINDINGS.confirm[0]);
    await h.step();
    h.tap(BINDINGS.pause[0]);
    await h.step();
    expect(h.api.snapshot().screen).toBe("paused");
    h.tap(BINDINGS.pause[0]);
    await h.step();
    expect(h.api.snapshot().screen).toBe("playing");
    h.dispose();
  });

  it("holds a paused hall exactly where the tick that paused it left it", async () => {
    const h = await harness();
    h.api.start();
    await h.step(30);
    const before = h.api.snapshot().train[0].s;
    h.tap(BINDINGS.pause[0]);
    await h.step(120);
    expect(h.api.snapshot().train[0].s).toBeCloseTo(before, 6);
    h.dispose();
  });

  it("dismisses an ending back to a fresh title", async () => {
    const h = await bare(5);
    await extractThree(h);
    expect(h.api.snapshot().screen).toBe("victory");
    h.tap(BINDINGS.confirm[0]);
    await h.step();
    const after = h.api.snapshot();
    expect(after.screen).toBe("title");
    expect(after.score).toBe(0);
    expect(after.level).toBe(1);
    expect(after.cells).toBe(CELLS);
    expect(after.injector.loaded).toBeNull();
    expect(after.injector.aim).toBe(270);
    h.dispose();
  });

  it("toggles the mute bit from any screen", async () => {
    const h = await harness();
    expect(h.api.snapshot().muted).toBe(false);
    h.tap(BINDINGS.mute[0]);
    await h.step();
    expect(h.api.snapshot().muted).toBe(true);
    h.tap(BINDINGS.mute[0]);
    await h.step();
    expect(h.api.snapshot().muted).toBe(false);
    h.dispose();
  });

  it("answers nothing but its own timer during an interlude", async () => {
    const h = await bare();
    await extractThree(h);
    const aim = h.api.snapshot().injector.aim;
    h.hold(BINDINGS.left[0]);
    h.tap(BINDINGS.a[0]);
    await h.step(30);
    const after = h.api.snapshot();
    expect(after.injector.aim).toBe(aim);
    expect(after.projectiles).toHaveLength(0);
    expect(after.interlude).toBeCloseTo(INTERLUDE - 0.5, 3);
    h.dispose();
  });
});

describe("a pose decides no outcome", () => {
  it("leaves a posed run of three standing, and scores nothing", async () => {
    const h = await harness();
    h.api.startLevel(1);
    h.api.setQuotaRemaining(0);
    h.api.clearTrain();
    h.api.poseTrain([
      [100, "halide", null],
      [128, "halide", null],
      [156, "halide", null],
    ]);
    await h.step(60);
    const after = h.api.snapshot();
    expect(after.train).toHaveLength(3);
    expect(after.score).toBe(0);
    h.dispose();
  });
});
