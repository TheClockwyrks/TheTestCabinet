// The shape of a run: the five levels, clearing, cells, the endings, danger, and
// the screens and controls around them.

import { describe, expect, it } from "vitest";
import {
  CELLS,
  CLEAR_BONUS,
  DANGER_S,
  INTERLUDE,
  LEVELS,
  PATH_LENGTH,
  SEED_CORES,
  SPACING,
} from "./constants";
import { levelSpec } from "./state";
import { harness, last, seatShot, topLegS } from "./harness.test";

function bare(level = 1) {
  const hall = harness();
  hall.api.startLevel(level);
  hall.api.setPressure(0);
  hall.api.setQuotaRemaining(0);
  hall.api.clearTrain();
  hall.api.poseTrain([[100, "olivine", null]]);
  return hall;
}

/** Seat the third core of a matching run, so the run leaves the channel. */
function extractThree(hall: ReturnType<typeof harness>): void {
  const head = topLegS(430);
  seatShot(
    hall,
    [
      [head, "halide", null],
      [head - SPACING, "halide", null],
    ],
    "halide",
  );
}

describe("the level table", () => {
  it("opens each level on its own quota", () => {
    const hall = harness();
    LEVELS.forEach((level, index) => {
      hall.api.startLevel(index + 1);
      expect(hall.api.snapshot().quotaRemaining + SEED_CORES).toBe(level.quota);
    });
  });

  it("rides each level at its own feed speed", () => {
    LEVELS.forEach((level, index) => {
      const hall = harness();
      hall.api.startLevel(index + 1);
      hall.api.setPressure(0);
      hall.api.setQuotaRemaining(0);
      hall.api.clearTrain();
      hall.api.poseTrain([[1000, "halide", null]]);
      hall.step(60);
      expect(hall.api.snapshot().train[0].s - 1000).toBeCloseTo(level.feed, 1);
    });
  });

  it("uses only its own charges", () => {
    LEVELS.forEach((level, index) => {
      const hall = harness(index + 7);
      hall.api.startLevel(index + 1);
      const seen = new Set(
        hall.api.snapshot().train.map((core) => core.charge),
      );
      let delivered = SEED_CORES;
      for (let i = 0; i < 4000 && delivered < SEED_CORES + 20; i += 1) {
        const before = hall.api.snapshot().emitted;
        hall.step();
        const after = hall.api.snapshot();
        if (after.emitted > before) {
          delivered += 1;
          seen.add(last(after.train).charge);
        }
      }
      for (const charge of seen) expect(level.charges).toContain(charge);
    });
  });

  it("clamps a level lookup outside the table into it", () => {
    // The lookup is the game's own rule, so it holds whatever number reaches it.
    // The debugging surface is a different question: `1` through `LEVEL_COUNT`
    // is the argument's domain there, and `src/debug.test.ts` covers it failing.
    expect(levelSpec(99)).toBe(LEVELS[LEVELS.length - 1]);
    expect(levelSpec(-3)).toBe(LEVELS[0]);
  });
});

describe("clearing a level", () => {
  it("clears the moment the quota is spent and the last core leaves", () => {
    const hall = bare();
    extractThree(hall);
    const after = hall.api.snapshot();
    expect(after.train).toHaveLength(0);
    expect(after.screen).toBe("cleared");
    expect(after.interlude).toBeCloseTo(INTERLUDE, 6);
    expect(hall.cues).toContain("level-clear");
  });

  it("adds the clear bonus on top of what the extraction paid", () => {
    const hall = bare();
    const before = hall.api.snapshot().score;
    extractThree(hall);
    expect(hall.api.snapshot().score - before).toBe(30 + CLEAR_BONUS);
  });

  it("opens the next level once the interlude has run", () => {
    const hall = bare();
    extractThree(hall);
    hall.step(121);
    const after = hall.api.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.level).toBe(2);
    expect(after.train).toHaveLength(SEED_CORES);
  });

  it("wins the run on the fifth level, with no interlude", () => {
    const hall = bare(5);
    extractThree(hall);
    const after = hall.api.snapshot();
    expect(after.screen).toBe("victory");
    expect(after.interlude).toBe(0);
    hall.step(600);
    expect(hall.api.snapshot().screen).toBe("victory");
  });
});

describe("cells", () => {
  it("spends exactly one cell when a core reaches the intake", () => {
    const hall = bare();
    hall.api.poseTrain([[PATH_LENGTH - 20, "halide", null]]);
    for (let i = 0; i < 200; i += 1) {
      hall.step();
      if (hall.api.snapshot().cells < CELLS) break;
    }
    const after = hall.api.snapshot();
    expect(after.cells).toBe(CELLS - 1);
    expect(after.screen).toBe("setback");
    expect(hall.cues).toContain("intake");
    expect(hall.cues).toContain("cell-lost");
  });

  it("empties the channel and discards every projectile", () => {
    const hall = bare();
    hall.api.poseTrain([
      [PATH_LENGTH, "halide", null],
      [PATH_LENGTH - 28, "halide", null],
    ]);
    hall.api.setAim(270);
    hall.api.fire();
    hall.step(2);
    const after = hall.api.snapshot();
    expect(after.cells).toBe(CELLS - 1);
    expect(after.train).toHaveLength(0);
    expect(after.projectiles).toHaveLength(0);
  });

  it("puts the level's opening figures back", () => {
    const hall = bare();
    hall.api.setPressure(80);
    hall.api.grantMachinery("choke");
    hall.api.setQuotaRemaining(20);
    hall.api.poseTrain([[PATH_LENGTH, "halide", null]]);
    hall.step();
    const after = hall.api.snapshot();
    expect(after.pressure).toBe(0);
    expect(after.machinery).toBeNull();
    expect(after.chainStep).toBe(1);
    expect(after.quotaRemaining).toBe(LEVELS[0].quota - SEED_CORES);
  });

  it("restarts the same level after the interlude", () => {
    const hall = bare();
    hall.api.poseTrain([[PATH_LENGTH, "halide", null]]);
    hall.step();
    expect(hall.api.snapshot().screen).toBe("setback");
    hall.step(121);
    const after = hall.api.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.level).toBe(1);
    expect(after.train).toHaveLength(SEED_CORES);
  });

  it("ends the run when the third cell goes", () => {
    const hall = bare();
    for (let spend = 0; spend < CELLS; spend += 1) {
      hall.api.resume();
      hall.api.setQuotaRemaining(0);
      hall.api.poseTrain([[PATH_LENGTH, "halide", null]]);
      hall.step();
      if (spend < CELLS - 1) hall.step(121);
    }
    const after = hall.api.snapshot();
    expect(after.cells).toBe(0);
    expect(after.screen).toBe("gameover");
    hall.step(600);
    expect(hall.api.snapshot().screen).toBe("gameover");
  });

  it("spends one cell at most on a tick", () => {
    const hall = bare();
    hall.api.poseTrain([
      [PATH_LENGTH, "halide", null],
      [PATH_LENGTH - 28, "halide", null],
    ]);
    hall.step();
    expect(hall.api.snapshot().cells).toBe(CELLS - 1);
  });
});

describe("danger", () => {
  it("reads as in danger while the head stands at or past the threshold", () => {
    const hall = bare();
    hall.api.poseTrain([[DANGER_S - 10, "halide", null]]);
    expect(hall.api.snapshot().danger).toBe(false);
    hall.api.poseTrain([[DANGER_S + 10, "halide", null]]);
    expect(hall.api.snapshot().danger).toBe(true);
  });

  it("is never in danger on an empty channel", () => {
    const hall = bare();
    hall.api.clearTrain();
    expect(hall.api.snapshot().danger).toBe(false);
  });
});

describe("the screens", () => {
  it("opens on the title", () => {
    const hall = harness();
    expect(hall.api.snapshot().screen).toBe("title");
    hall.step(120);
    expect(hall.api.snapshot().screen).toBe("title");
  });

  it("starts a run on the confirm control", () => {
    const hall = harness();
    hall.press("confirm");
    hall.step();
    const after = hall.api.snapshot();
    expect(after.screen).toBe("playing");
    expect(after.level).toBe(1);
    expect(after.cells).toBe(CELLS);
    expect(after.score).toBe(0);
    expect(after.train).toHaveLength(SEED_CORES);
  });

  it("pauses and resumes on the pause control", () => {
    const hall = harness();
    hall.press("confirm");
    hall.step();
    hall.press("pause");
    hall.step();
    expect(hall.api.snapshot().screen).toBe("paused");
    hall.press("pause");
    hall.step();
    expect(hall.api.snapshot().screen).toBe("playing");
  });

  it("dismisses an ending back to a fresh title", () => {
    const hall = bare(5);
    extractThree(hall);
    expect(hall.api.snapshot().screen).toBe("victory");
    hall.press("confirm");
    hall.step();
    const after = hall.api.snapshot();
    expect(after.screen).toBe("title");
    expect(after.score).toBe(0);
    expect(after.level).toBe(1);
    expect(after.cells).toBe(CELLS);
    expect(after.injector.loaded).toBeNull();
    expect(after.injector.aim).toBe(270);
  });

  it("toggles the mute bit from any screen", () => {
    const hall = harness();
    expect(hall.api.snapshot().muted).toBe(false);
    hall.press("mute");
    hall.step();
    expect(hall.muted()).toBe(true);
    expect(hall.api.snapshot().muted).toBe(true);
    hall.press("mute");
    hall.step();
    expect(hall.api.snapshot().muted).toBe(false);
  });

  it("answers nothing but its own timer during an interlude", () => {
    const hall = bare();
    extractThree(hall);
    const aim = hall.api.snapshot().injector.aim;
    hall.hold("left");
    hall.press("fire");
    hall.step(30);
    const after = hall.api.snapshot();
    expect(after.injector.aim).toBe(aim);
    expect(after.projectiles).toHaveLength(0);
    expect(after.interlude).toBeCloseTo(INTERLUDE - 0.5, 3);
  });
});

describe("a pose decides no outcome", () => {
  it("leaves a posed run of three standing, and scores nothing", () => {
    const hall = harness();
    hall.api.reset();
    hall.api.startLevel(1);
    hall.api.setQuotaRemaining(0);
    hall.api.clearTrain();
    hall.api.poseTrain([
      [100, "halide", null],
      [128, "halide", null],
      [156, "halide", null],
    ]);
    hall.step(60);
    const after = hall.api.snapshot();
    expect(after.train).toHaveLength(3);
    expect(after.score).toBe(0);
  });
});
