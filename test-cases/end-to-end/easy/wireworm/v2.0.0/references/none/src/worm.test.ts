// Wireworm — the data-worm's step (specs/worm.md).
//
// Every check here poses a board, takes whole steps through the game's own
// `stepWorm`, and reads the tiles back. The block rules and the drop rules are
// separated the way the specification separates them: only a HORIZONTAL step can
// be blocked, so the vertical move a block produces enters the tile below
// whatever stands there.

import { describe, expect, test } from "vitest";
import {
  BAND_TOP_ROW,
  CHARGE_MAX,
  COLS,
  CUES,
  ROWS,
  WORM_BASE_LENGTH,
  WORM_LENGTH_PER_LEVEL,
  WORM_STEP_DECAY,
  WORM_STEP_FLOOR,
  WORM_STEP_L1,
  wormLength,
  wormStepInterval,
} from "./constants";
import { chargeAt, setCharge } from "./field";
import { updateWorms } from "./game";
import { CueLog, layWorm, posedState, stubApi } from "./harness.test-support";
import { bumpNode, removeSegments, segmentAt, stepWorm } from "./worm";
import type { Worm } from "./types";

/** The tiles a worm occupies, head first. */
function tiles(worm: Worm): [number, number][] {
  return worm.segments.map((segment) => [segment.c, segment.r]);
}

describe("the step interval and the length", () => {
  test("the interval is the closed form the specification states", () => {
    for (let level = 1; level <= 12; level += 1) {
      expect(wormStepInterval(level)).toBeCloseTo(
        Math.max(
          WORM_STEP_FLOOR,
          WORM_STEP_L1 * WORM_STEP_DECAY ** (level - 1),
        ),
        10,
      );
    }
    expect(wormStepInterval(1)).toBeCloseTo(0.14, 10);
    expect(wormStepInterval(12)).toBeCloseTo(0.0796, 4);
  });

  test("the floor never binds inside the twelve-level run", () => {
    for (let level = 1; level <= 12; level += 1) {
      expect(wormStepInterval(level)).toBeGreaterThan(WORM_STEP_FLOOR);
    }
  });

  test("the length climbs two segments a level", () => {
    expect(wormLength(1)).toBe(WORM_BASE_LENGTH);
    expect(wormLength(6)).toBe(WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * 5);
    expect(wormLength(12)).toBe(32);
  });
});

describe("winding", () => {
  test("a clear row advances the head one tile a step, holding its row", () => {
    const state = posedState();
    const worm = layWorm(state, [[5, 5]]);
    const cues = new CueLog();
    for (let step = 1; step <= 4; step += 1) {
      stepWorm(state, worm, cues);
      expect(tiles(worm)[0]).toEqual([5 + step, 5]);
    }
    expect(worm.dh).toBe(1);
    expect(worm.dv).toBe(1);
  });

  test("each segment moves into the tile the one ahead of it held", () => {
    const state = posedState();
    const worm = layWorm(state, [
      [8, 6],
      [7, 6],
      [6, 6],
      [5, 6],
      [4, 6],
      [3, 6],
    ]);
    const cues = new CueLog();
    for (let step = 0; step < 5; step += 1) {
      const before = tiles(worm);
      stepWorm(state, worm, cues);
      const after = tiles(worm);
      for (let i = 1; i < after.length; i += 1) {
        expect(after[i]).toEqual(before[i - 1]);
      }
    }
  });

  test("a gated body holds its tiles while the head runs on", () => {
    const state = posedState();
    const worm = layWorm(
      state,
      [
        [8, 6],
        [7, 6],
        [6, 6],
      ],
      { body: false },
    );
    const cues = new CueLog();
    stepWorm(state, worm, cues);
    expect(tiles(worm)).toEqual([
      [9, 6],
      [7, 6],
      [6, 6],
    ]);
  });

  test("a gated step moves nothing", () => {
    const state = posedState();
    const worm = layWorm(state, [[8, 6]], { stepping: false });
    const cues = new CueLog();
    stepWorm(state, worm, cues);
    expect(tiles(worm)).toEqual([[8, 6]]);
  });
});

describe("what blocks a step", () => {
  test("a node blocks the step, reverses the heading, and drops one row", () => {
    const state = posedState();
    setCharge(state.field, 6, 5, 0);
    const worm = layWorm(state, [[5, 5]]);
    stepWorm(state, worm, new CueLog());
    expect(tiles(worm)[0]).toEqual([5, 6]);
    expect(worm.dh).toBe(-1);
    expect(worm.dv).toBe(1);
  });

  test("a bumped node gains one charge, capped at critical", () => {
    const state = posedState();
    const cues = new CueLog();
    setCharge(state.field, 6, 5, 0);
    for (const expected of [1, 2, 3, 3]) {
      const worm = layWorm(state, [[5, 5]]);
      worm.dh = 1;
      stepWorm(state, worm, cues);
      expect(chargeAt(state.field, 6, 5)).toBe(expected);
      state.worms = [];
    }
    // The cue sounds on the step it REACHES critical, and only then.
    expect(cues.count(CUES.critical)).toBe(1);
  });

  test("the side edge blocks and turns the worm, charging nothing", () => {
    const state = posedState();
    setCharge(state.field, 5, 5, 1);
    const worm = layWorm(state, [[0, 5]], { dh: -1 });
    stepWorm(state, worm, new CueLog());
    expect(tiles(worm)[0]).toEqual([0, 6]);
    expect(worm.dh).toBe(1);
    expect(chargeAt(state.field, 5, 5)).toBe(1);

    const right = layWorm(state, [[COLS - 1, 5]], { dh: 1 });
    stepWorm(state, right, new CueLog());
    expect(tiles(right)[0]).toEqual([COLS - 1, 6]);
    expect(right.dh).toBe(-1);
  });

  test("another worm's segment blocks and turns it, charging nothing", () => {
    const state = posedState();
    setCharge(state.field, 20, 10, 1);
    layWorm(state, [[6, 5]], { stepping: false });
    const worm = layWorm(state, [[5, 5]]);
    stepWorm(state, worm, new CueLog());
    expect(tiles(worm)[0]).toEqual([5, 6]);
    expect(worm.dh).toBe(-1);
    expect(chargeAt(state.field, 20, 10)).toBe(1);
  });

  test("only a horizontal step is blocked, so a drop passes through a node", () => {
    const state = posedState();
    setCharge(state.field, 6, 5, 0);
    setCharge(state.field, 5, 6, 2);
    const worm = layWorm(state, [[5, 5]]);
    stepWorm(state, worm, new CueLog());
    expect(tiles(worm)[0]).toEqual([5, 6]);
    expect(worm.dv).toBe(1);
    // The node it landed on keeps the charge it had.
    expect(chargeAt(state.field, 5, 6)).toBe(2);
  });

  test("a drop passes through a segment as well", () => {
    const state = posedState();
    setCharge(state.field, 6, 5, 0);
    layWorm(state, [[5, 6]], { stepping: false });
    const worm = layWorm(state, [[5, 5]]);
    stepWorm(state, worm, new CueLog());
    expect(tiles(worm)[0]).toEqual([5, 6]);
    expect(segmentAt(state, 5, 6)).toBe(true);
  });
});

describe("oscillating", () => {
  test("a block on the floor flips the worm upward", () => {
    const state = posedState();
    setCharge(state.field, 6, ROWS - 1, 0);
    const worm = layWorm(state, [[5, ROWS - 1]], { dv: 1 });
    stepWorm(state, worm, new CueLog());
    expect(worm.dv).toBe(-1);
    expect(tiles(worm)[0]).toEqual([5, ROWS - 2]);
  });

  test("a block on the entry row flips it back down", () => {
    const state = posedState();
    setCharge(state.field, 6, 0, 0);
    const worm = layWorm(state, [[5, 0]], { dv: -1 });
    stepWorm(state, worm, new CueLog());
    expect(worm.dv).toBe(1);
    expect(tiles(worm)[0]).toEqual([5, 1]);
  });

  test("a worm never leaves the board", () => {
    const state = posedState();
    const worm = layWorm(state, [[0, 0]]);
    const cues = new CueLog();
    for (let step = 0; step < 400; step += 1) {
      stepWorm(state, worm, cues);
      const [c, r] = tiles(worm)[0];
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(COLS);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(ROWS);
    }
  });
});

describe("diving", () => {
  test("a critical node starts a dive one row down, in the worm's own column", () => {
    const state = posedState();
    setCharge(state.field, 6, 5, CHARGE_MAX);
    const worm = layWorm(state, [[5, 5]]);
    stepWorm(state, worm, new CueLog());
    expect(worm.diving).toBe(true);
    expect(tiles(worm)[0]).toEqual([5, 6]);
    expect(worm.dh).toBe(1);
  });

  test("a dive crosses whatever is below it, and leaves it as it was", () => {
    const state = posedState();
    setCharge(state.field, 6, 5, CHARGE_MAX);
    for (let r = 6; r <= 12; r += 1) setCharge(state.field, 5, r, 2);
    const worm = layWorm(state, [[5, 5]]);
    const cues = new CueLog();
    stepWorm(state, worm, cues);
    for (let step = 0; step < 6; step += 1) {
      const before = tiles(worm)[0][1];
      stepWorm(state, worm, cues);
      expect(tiles(worm)[0]).toEqual([5, before + 1]);
    }
    for (let r = 6; r <= 12; r += 1)
      expect(chargeAt(state.field, 5, r)).toBe(2);
  });

  test("the dive ends at the band and the worm winds again", () => {
    const state = posedState();
    setCharge(state.field, 6, 14, CHARGE_MAX);
    const worm = layWorm(state, [[5, 14]]);
    const cues = new CueLog();
    stepWorm(state, worm, cues);
    while (worm.diving) stepWorm(state, worm, cues);
    expect(tiles(worm)[0]).toEqual([5, BAND_TOP_ROW]);
    stepWorm(state, worm, cues);
    // Winding again: the head has moved along its row rather than down.
    expect(tiles(worm)[0]).toEqual([6, BAND_TOP_ROW]);
  });

  test("a critical block inside the band turns the worm the ordinary way", () => {
    const state = posedState();
    setCharge(state.field, 6, BAND_TOP_ROW, CHARGE_MAX);
    const worm = layWorm(state, [[5, BAND_TOP_ROW]]);
    stepWorm(state, worm, new CueLog());
    expect(worm.diving).toBe(false);
    expect(worm.dh).toBe(-1);
    expect(tiles(worm)[0]).toEqual([5, BAND_TOP_ROW + 1]);
  });
});

describe("removing segments", () => {
  test("a head removed leaves one worm led by the second segment", () => {
    const state = posedState();
    const worm = layWorm(state, [
      [5, 5],
      [4, 5],
      [3, 5],
    ]);
    removeSegments(state, worm, [false, true, true]);
    expect(state.worms).toHaveLength(1);
    expect(tiles(state.worms[0])).toEqual([
      [4, 5],
      [3, 5],
    ]);
    expect(state.worms[0].id).toBe(worm.id);
  });

  test("a tail removed leaves one worm with the same head", () => {
    const state = posedState();
    const worm = layWorm(state, [
      [5, 5],
      [4, 5],
      [3, 5],
    ]);
    removeSegments(state, worm, [true, true, false]);
    expect(tiles(state.worms[0])).toEqual([
      [5, 5],
      [4, 5],
    ]);
    expect(state.worms[0].id).toBe(worm.id);
  });

  test("a middle removed leaves two worms, and the head-side keeps the id", () => {
    const state = posedState();
    const worm = layWorm(state, [
      [7, 5],
      [6, 5],
      [5, 5],
      [4, 5],
      [3, 5],
      [2, 5],
      [1, 5],
    ]);
    const was = worm.id;
    removeSegments(state, worm, [true, true, true, false, true, true, true]);
    expect(state.worms).toHaveLength(2);
    expect(state.worms[0].id).toBe(was);
    expect(tiles(state.worms[0])).toHaveLength(3);
    expect(state.worms[1].id).not.toBe(was);
    expect(tiles(state.worms[1])).toEqual([
      [3, 5],
      [2, 5],
      [1, 5],
    ]);
    // The trailing piece leads from the segment nearest the break.
    stepWorm(state, state.worms[1], new CueLog());
    expect(tiles(state.worms[1])[0]).toEqual([4, 5]);
  });

  test("a new piece takes the headings and a step clock of its own", () => {
    const state = posedState();
    const worm = layWorm(
      state,
      [
        [7, 5],
        [6, 5],
        [5, 5],
      ],
      { dh: -1, dv: -1, diving: true, stepClock: 0.09 },
    );
    removeSegments(state, worm, [true, false, true]);
    const trailing = state.worms[1];
    expect(trailing.dh).toBe(-1);
    expect(trailing.dv).toBe(-1);
    expect(trailing.diving).toBe(true);
    expect(trailing.stepClock).toBe(0);
    // The head-side piece is the same worm, so it keeps the clock it had.
    expect(state.worms[0].stepClock).toBeCloseTo(0.09, 10);
  });

  test("a worm with no survivors leaves the roster", () => {
    const state = posedState();
    const worm = layWorm(state, [
      [5, 5],
      [4, 5],
    ]);
    const result = removeSegments(state, worm, [false, false]);
    expect(state.worms).toEqual([]);
    expect(result.headRemoved).toBe(true);
    expect(result.removed).toHaveLength(2);
  });
});

describe("the step clock", () => {
  test("a level-1 worm takes one step every 0.14 s", () => {
    const state = posedState();
    const worm = layWorm(state, [[2, 5]]);
    const cues = new CueLog();
    const api = stubApi(cues);
    for (let step = 1; step <= 10; step += 1) {
      updateWorms(state, wormStepInterval(1), cues);
      expect(tiles(worm)[0]).toEqual([2 + step, 5]);
    }
    expect(api.input.value("left")).toBe(0);
  });

  test("one long frame runs every step it covered, and carries the remainder", () => {
    const state = posedState();
    const worm = layWorm(state, [[2, 5]]);
    const cues = new CueLog();
    const interval = wormStepInterval(1);
    updateWorms(state, interval * 3.5, cues);
    expect(tiles(worm)[0]).toEqual([5, 5]);
    expect(worm.stepClock).toBeCloseTo(interval * 0.5, 6);
    // The remainder carries: half an interval more takes the fourth step.
    updateWorms(state, interval * 0.5, cues);
    expect(tiles(worm)[0]).toEqual([6, 5]);
  });

  test("a gated worm does not accumulate the steps it did not take", () => {
    const state = posedState();
    const worm = layWorm(state, [[2, 5]], { stepping: false });
    const cues = new CueLog();
    updateWorms(state, wormStepInterval(1) * 10, cues);
    expect(tiles(worm)[0]).toEqual([2, 5]);
    expect(worm.stepClock).toBe(0);
  });

  test("bumping an empty tile or a critical node changes nothing", () => {
    const state = posedState();
    const cues = new CueLog();
    bumpNode(state, 4, 4, cues);
    expect(chargeAt(state.field, 4, 4)).toBe(-1);
    setCharge(state.field, 4, 4, CHARGE_MAX);
    bumpNode(state, 4, 4, cues);
    expect(chargeAt(state.field, 4, 4)).toBe(CHARGE_MAX);
    expect(cues.played).toEqual([]);
  });
});
