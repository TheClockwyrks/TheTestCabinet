// The foes' motion and their own spawners, run directly over a working state so
// a departure from the board and a paced arrival are both reachable.

import { describe, expect, it } from "vitest";
import {
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_SPEED,
  DROPPER_CHECK_INTERVAL,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
  DROPPER_SPEED,
  GLITCH_FROM_LEVEL,
  GLITCH_H_SPEED,
  GLITCH_MAX_INTERVAL,
  GLITCH_MAX_ON_BOARD,
  GLITCH_V_SPEED,
  STAGE_H,
  STAGE_W,
  tileCX,
  tileCY,
} from "./constants";
import { putNode } from "./field";
import { blankState } from "./flow";
import {
  CORRUPTOR_ENTRY_ROWS,
  GLITCH_ENTRY_ROWS,
  addFoe,
  advanceFoes,
  nodesBelow,
  restingVelocity,
  runSpawners,
} from "./foes";
import { newFrameEvents, toSim, type Sim } from "./sim";

function sim(level = 1): Sim {
  const s = toSim(blankState());
  s.level = level;
  return s;
}

/** Run `seconds` of foe motion in sixtieths. */
function run(s: Sim, seconds: number): void {
  const ev = newFrameEvents();
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) advanceFoes(s, 1 / 60, ev);
}

describe("resting velocity", () => {
  it("is each kind's own, in the direction it was given", () => {
    expect(restingVelocity("glitch", -1)).toEqual({
      vx: -GLITCH_H_SPEED,
      vy: GLITCH_V_SPEED,
    });
    expect(restingVelocity("dropper", 1)).toEqual({
      vx: 0,
      vy: DROPPER_SPEED,
    });
    expect(restingVelocity("corruptor", -1)).toEqual({
      vx: -CORRUPTOR_SPEED,
      vy: 0,
    });
  });
});

describe("travel", () => {
  it("turns a glitch back at a side edge of the board", () => {
    const s = sim();
    const glitch = addFoe(s, "glitch", 40, tileCY(10), -1);
    glitch.mind = false;
    run(s, 0.5);
    expect(glitch.x).toBeGreaterThanOrEqual(0);
    expect(glitch.vx).toBeGreaterThan(0);

    glitch.x = STAGE_W - 40;
    glitch.vx = GLITCH_H_SPEED;
    run(s, 0.5);
    expect(glitch.x).toBeLessThanOrEqual(STAGE_W);
    expect(glitch.vx).toBeLessThan(0);
  });

  it("takes a glitch and a dropper off the board below it", () => {
    const s = sim();
    addFoe(s, "glitch", 400, STAGE_H - 10);
    addFoe(s, "dropper", 500, STAGE_H - 10);
    run(s, 1);
    expect(s.foes).toHaveLength(0);
  });

  it("takes a corruptor off the board past a side edge", () => {
    const s = sim();
    addFoe(s, "corruptor", STAGE_W - 10, tileCY(3), 1);
    run(s, 1);
    expect(s.foes).toHaveLength(0);
  });

  it("holds a foe still with its travel off, and it still acts", () => {
    const s = sim();
    putNode(s, 10, 10, 2);
    const glitch = addFoe(s, "glitch", tileCX(10), tileCY(10));
    glitch.travel = false;
    run(s, 1);
    expect(glitch.x).toBeCloseTo(tileCX(10), 6);
    expect(glitch.y).toBeCloseTo(tileCY(10), 6);
    expect(s.nodes).toHaveLength(0);
  });

  it("descends a glitch at its own rate while it darts", () => {
    const s = sim();
    const glitch = addFoe(s, "glitch", 640, tileCY(8));
    const before = glitch.y;
    run(s, 1);
    expect(glitch.y - before).toBeCloseTo(GLITCH_V_SPEED, 0);
  });
});

describe("the level's own spawners", () => {
  it("brings in no glitch below its level, and one inside its interval above it", () => {
    const below = sim(GLITCH_FROM_LEVEL - 1);
    for (let i = 0; i < 60 * 60; i++) runSpawners(below, 1 / 60);
    expect(below.foes).toHaveLength(0);

    const s = sim(GLITCH_FROM_LEVEL);
    let elapsed = 0;
    while (s.foes.length === 0 && elapsed < GLITCH_MAX_INTERVAL + 1) {
      runSpawners(s, 1 / 60);
      elapsed += 1 / 60;
    }
    expect(s.foes).toHaveLength(1);
    const glitch = s.foes[0];
    expect(glitch?.kind).toBe("glitch");
    const row = Math.round((((glitch?.y as number) - 80 - 16) / 32) * 1);
    expect(row).toBeGreaterThanOrEqual(GLITCH_ENTRY_ROWS[0]);
    expect(row).toBeLessThanOrEqual(GLITCH_ENTRY_ROWS[1]);
  });

  it("holds the board to the glitch cap", () => {
    const s = sim(GLITCH_FROM_LEVEL);
    for (let i = 0; i < 60 * 120; i++) runSpawners(s, 1 / 60);
    expect(s.foes.length).toBeLessThanOrEqual(GLITCH_MAX_ON_BOARD);
  });

  it("brings in a corruptor on its own interval, on its own rows", () => {
    const s = sim(CORRUPTOR_FROM_LEVEL);
    // Glitches share this level, so the corruptor is picked out by its kind.
    let elapsed = 0;
    while (
      !s.foes.some((foe) => foe.kind === "corruptor") &&
      elapsed < CORRUPTOR_MAX_INTERVAL + 1
    ) {
      runSpawners(s, 1 / 60);
      elapsed += 1 / 60;
    }
    const corruptor = s.foes.find((foe) => foe.kind === "corruptor");
    expect(corruptor).toBeDefined();
    const row = Math.round(((corruptor?.y as number) - 80 - 16) / 32);
    expect(row).toBeGreaterThanOrEqual(CORRUPTOR_ENTRY_ROWS[0]);
    expect(row).toBeLessThanOrEqual(CORRUPTOR_ENTRY_ROWS[1]);
  });

  it("draws a dropper in on a sparse lower field and not on a dense one", () => {
    const sparse = sim(DROPPER_FROM_LEVEL);
    for (let i = 0; i < Math.round((DROPPER_CHECK_INTERVAL + 0.5) * 60); i++) {
      runSpawners(sparse, 1 / 60);
    }
    expect(sparse.foes.some((foe) => foe.kind === "dropper")).toBe(true);

    const dense = sim(DROPPER_FROM_LEVEL);
    for (let c = 0; c < DROPPER_SPARSE_THRESHOLD + 2; c++) {
      putNode(dense, c, 12, 0);
    }
    expect(nodesBelow(dense)).toBeGreaterThanOrEqual(DROPPER_SPARSE_THRESHOLD);
    for (let i = 0; i < Math.round((DROPPER_CHECK_INTERVAL + 0.5) * 60); i++) {
      runSpawners(dense, 1 / 60);
    }
    expect(dense.foes.some((foe) => foe.kind === "dropper")).toBe(false);
  });

  it("counts only the rows the sparse-field check reads", () => {
    const s = sim();
    putNode(s, 0, 9, 0);
    putNode(s, 1, 10, 0);
    putNode(s, 2, 19, 0);
    expect(nodesBelow(s)).toBe(2);
  });
});
