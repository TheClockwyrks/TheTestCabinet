// Wireworm — the bolts and what they resolve against (specs/cursor.md,
// specs/nodes.md, specs/worm.md, specs/foes.md).
//
// The bolt sweeps the interval it covered, so the verdict is the same however
// the second was divided into frames — which is checked outright below, because
// a build that tested only where the bolt LANDED would carry it straight through
// a node on a long frame.

import { describe, expect, test } from "vitest";
import {
  BOARD_Y,
  BOLT_SPEED,
  CHARGE_MAX,
  CUES,
  DROPPER_SPEED_HIT,
  FOE_HALF,
  SCORE_BODY,
  SCORE_CORRUPTOR,
  SCORE_DROPPER,
  SCORE_GLITCH,
  SCORE_HEAD,
  SCORE_INERT_NODE,
  tileCX,
  tileCY,
} from "./constants";
import { chargeAt, hasNode, setCharge } from "./field";
import { makeFoe } from "./foes";
import { CueLog, layWorm, posedState } from "./harness.test-support";
import { updateBolts } from "./shots";
import type { FoeKind, WirewormState } from "./types";

/** The y a bolt fired from the band starts at. */
const MUZZLE = 692;

function addBolt(state: WirewormState, x: number, y: number): void {
  state.bolts.push({ id: state.nextId, x, y });
  state.nextId += 1;
}

function addFoe(
  state: WirewormState,
  kind: FoeKind,
  x: number,
  y: number,
): ReturnType<typeof makeFoe> {
  const foe = makeFoe(state, kind, x, y);
  foe.travel = false;
  state.foes.push(foe);
  return foe;
}

/** Run bolt time in `frames` frames. */
function fly(
  state: WirewormState,
  seconds: number,
  frames: number,
  cues = new CueLog(),
): CueLog {
  for (let i = 0; i < frames; i += 1)
    updateBolts(state, seconds / frames, cues);
  return cues;
}

describe("a bolt in flight", () => {
  test("it climbs at its own rate and holds its column", () => {
    const state = posedState();
    addBolt(state, tileCX(9), 704);
    fly(state, 0.5, 30);
    expect(state.bolts).toHaveLength(1);
    expect(state.bolts[0].x).toBe(tileCX(9));
    expect(704 - state.bolts[0].y).toBeCloseTo(BOLT_SPEED * 0.5, 3);
  });

  test("it leaves once its center passes the top of the board", () => {
    const state = posedState();
    addBolt(state, tileCX(9), 704);
    fly(state, 1, 60);
    expect(state.bolts).toEqual([]);
  });

  test("it is consumed by the first node in its column, whatever the frame length", () => {
    for (const frames of [1, 4, 60]) {
      const state = posedState();
      setCharge(state.field, 9, 12, 0);
      setCharge(state.field, 9, 6, 0);
      addBolt(state, tileCX(9), MUZZLE);
      fly(state, 0.5, frames);
      expect(state.bolts).toEqual([]);
      // The nearer node cleared; the one above it is untouched.
      expect(hasNode(state.field, 9, 12)).toBe(false);
      expect(hasNode(state.field, 9, 6)).toBe(true);
    }
  });

  test("it is consumed by the first segment, and removes only that one", () => {
    const state = posedState();
    layWorm(state, [
      [9, 12],
      [9, 8],
    ]);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.bolts).toEqual([]);
    expect(state.worms).toHaveLength(1);
    expect(state.worms[0].segments).toEqual([{ c: 9, r: 8 }]);
  });

  test("it is consumed by the first foe, leaving a node above it standing", () => {
    const state = posedState();
    addFoe(state, "glitch", tileCX(9), tileCY(12));
    setCharge(state.field, 9, 6, 1);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.foes).toEqual([]);
    expect(chargeAt(state.field, 9, 6)).toBe(1);
  });

  test("a foe out of the bolt's column is not struck", () => {
    const state = posedState();
    addFoe(state, "glitch", tileCX(9) + FOE_HALF + 2, tileCY(12));
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.foes).toHaveLength(1);
  });

  test("where a segment and a node share a tile, the segment is what was struck", () => {
    const state = posedState();
    setCharge(state.field, 9, 12, 2);
    layWorm(state, [
      [9, 12],
      [8, 12],
    ]);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.worms[0].segments).toEqual([{ c: 8, r: 12 }]);
    // The node under it keeps the charge it had.
    expect(chargeAt(state.field, 9, 12)).toBe(2);
  });
});

describe("what a bolt does to a node", () => {
  test("an inert node is removed and pays one", () => {
    const state = posedState();
    setCharge(state.field, 9, 12, 0);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(hasNode(state.field, 9, 12)).toBe(false);
    expect(state.score).toBe(SCORE_INERT_NODE);
  });

  test("a charged node is knocked down one level and left standing", () => {
    for (const [charge, left] of [
      [1, 0],
      [2, 1],
    ]) {
      const state = posedState();
      setCharge(state.field, 9, 12, charge);
      addBolt(state, tileCX(9), MUZZLE);
      fly(state, 0.5, 30);
      expect(chargeAt(state.field, 9, 12)).toBe(left);
      // De-energizing pays nothing.
      expect(state.score).toBe(0);
    }
  });

  test("a critical node detonates rather than dropping a level", () => {
    const state = posedState();
    setCharge(state.field, 9, 12, CHARGE_MAX);
    addBolt(state, tileCX(9), MUZZLE);
    const cues = fly(state, 0.5, 30);
    expect(hasNode(state.field, 9, 12)).toBe(false);
    expect(cues.count(CUES.discharge)).toBe(1);
  });
});

describe("what a bolt does to a worm", () => {
  test("the head shortens the worm and the second segment leads", () => {
    const state = posedState();
    const worm = layWorm(state, [
      [9, 12],
      [8, 12],
      [7, 12],
    ]);
    addBolt(state, tileCX(9), MUZZLE);
    const cues = fly(state, 0.5, 30);
    expect(state.worms).toHaveLength(1);
    expect(state.worms[0].id).toBe(worm.id);
    expect(state.worms[0].segments).toEqual([
      { c: 8, r: 12 },
      { c: 7, r: 12 },
    ]);
    expect(state.score).toBe(SCORE_HEAD);
    expect(cues.count(CUES.cut)).toBe(1);
  });

  test("the tail shortens the worm and the head is unchanged", () => {
    const state = posedState();
    layWorm(state, [
      [7, 12],
      [8, 12],
      [9, 12],
    ]);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.worms[0].segments).toEqual([
      { c: 7, r: 12 },
      { c: 8, r: 12 },
    ]);
    expect(state.score).toBe(SCORE_BODY);
  });

  test("a middle segment splits the worm in two", () => {
    const state = posedState();
    layWorm(state, [
      [12, 12],
      [11, 12],
      [10, 12],
      [9, 12],
      [8, 12],
      [7, 12],
      [6, 12],
    ]);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.worms).toHaveLength(2);
    expect(state.worms[0].segments).toHaveLength(3);
    expect(state.worms[1].segments).toHaveLength(3);
  });

  test("a killed segment leaves a fresh inert node where it stood", () => {
    const state = posedState();
    layWorm(state, [
      [9, 12],
      [8, 12],
    ]);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(chargeAt(state.field, 9, 12)).toBe(0);
  });
});

describe("what a bolt does to a foe", () => {
  test("one bolt destroys a glitch and pays its bounty", () => {
    const state = posedState();
    addFoe(state, "glitch", tileCX(9), tileCY(12));
    addBolt(state, tileCX(9), MUZZLE);
    const cues = fly(state, 0.5, 30);
    expect(state.foes).toEqual([]);
    expect(state.score).toBe(SCORE_GLITCH);
    expect(cues.count(CUES.foe)).toBe(1);
  });

  test("one bolt destroys a corruptor and pays its bounty", () => {
    const state = posedState();
    addFoe(state, "corruptor", tileCX(9), tileCY(12));
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.foes).toEqual([]);
    expect(state.score).toBe(SCORE_CORRUPTOR);
  });

  test("a dropper's first bolt marks it and speeds it up, and pays nothing", () => {
    const state = posedState();
    const dropper = addFoe(state, "dropper", tileCX(9), tileCY(12));
    addBolt(state, tileCX(9), MUZZLE);
    const cues = fly(state, 0.5, 30);
    expect(state.foes).toHaveLength(1);
    expect(dropper.hit).toBe(true);
    expect(dropper.vy).toBe(DROPPER_SPEED_HIT);
    expect(state.score).toBe(0);
    expect(cues.count(CUES.foe)).toBe(0);
  });

  test("a dropper's second bolt destroys it and pays its bounty", () => {
    const state = posedState();
    const dropper = addFoe(state, "dropper", tileCX(9), tileCY(12));
    dropper.hit = true;
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.foes).toEqual([]);
    expect(state.score).toBe(SCORE_DROPPER);
  });
});

describe("removing the last segment", () => {
  test("a bolt that empties the board clears the level", () => {
    const state = posedState(4);
    layWorm(state, [[9, 12]]);
    addBolt(state, tileCX(9), MUZZLE);
    const cues = fly(state, 0.5, 30);
    expect(state.level).toBe(5);
    expect(state.phase).toBe("banner");
    expect(cues.count(CUES.levelClear)).toBe(1);
  });

  test("a board that never held a worm is played rather than cleared", () => {
    const state = posedState(4);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 2, 120);
    expect(state.level).toBe(4);
    expect(state.phase).toBe("active");
  });

  test("a discharge that destroys no segment clears nothing", () => {
    const state = posedState(4);
    setCharge(state.field, 9, 12, CHARGE_MAX);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.level).toBe(4);
    expect(state.phase).toBe("active");
  });

  test("a discharge that empties the board clears the level too", () => {
    const state = posedState(4);
    setCharge(state.field, 9, 12, CHARGE_MAX);
    layWorm(state, [[10, 12]]);
    addBolt(state, tileCX(9), MUZZLE);
    fly(state, 0.5, 30);
    expect(state.level).toBe(5);
  });
});

describe("the board's edges", () => {
  test("a bolt outside the board's columns strikes nothing and leaves", () => {
    const state = posedState();
    addBolt(state, -20, 704);
    fly(state, 1, 60);
    expect(state.bolts).toEqual([]);
  });

  test("a bolt already above the board leaves on its first frame", () => {
    const state = posedState();
    addBolt(state, tileCX(4), BOARD_Y - 1);
    fly(state, 0.02, 1);
    expect(state.bolts).toEqual([]);
  });
});
