import { describe, expect, it } from "vitest";
import { noCues } from "./audio";
import { BAND_TOP_ROW, COLS, wormLength, wormStepInterval } from "./constants";
import { playingState, poseWorm } from "./fixtures";
import { nodeAt, putNode } from "./grid";
import { advanceWorms, cutWorm, enterLevelWorm, stepWorm } from "./worm";

/** The head tile of the worm at `index` in the roster. */
function head(state: ReturnType<typeof playingState>, index = 0) {
  const segment = state.worms[index].segments[0];
  return [segment.c, segment.r];
}

describe("the worm's step clock", () => {
  it("takes one step per interval and carries the remainder", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, 5);
    const interval = wormStepInterval(1);
    advanceWorms(state, interval * 2 + interval / 7, noCues());
    expect(head(state)).toEqual([7, 5]);
    expect(worm.stepClock).toBeCloseTo(interval / 7, 6);
  });

  it("reaches the same place however the interval was divided into frames", () => {
    const coarse = playingState();
    poseWorm(coarse, 5, 5);
    advanceWorms(coarse, 1, noCues());

    const fine = playingState();
    poseWorm(fine, 5, 5);
    for (let frame = 0; frame < 60; frame += 1) {
      advanceWorms(fine, 1 / 60, noCues());
    }
    expect(head(fine)).toEqual(head(coarse));
  });

  it("does not step a worm whose step is held", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, 5);
    worm.stepping = false;
    advanceWorms(state, 1, noCues());
    expect(head(state)).toEqual([5, 5]);
  });
});

describe("winding down the board", () => {
  it("moves the head one tile along its heading, and the body follows its path", () => {
    const state = playingState();
    poseWorm(state, 5, 5, 3);
    stepWorm(state, state.worms[0], noCues());
    expect(state.worms[0].segments.map((s) => [s.c, s.r])).toEqual([
      [6, 5],
      [5, 5],
      [4, 5],
    ]);
  });

  it("charges the node it is blocked by, reverses, and drops a row", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, 5, 2);
    putNode(state, 6, 5, 0);
    stepWorm(state, worm, noCues());
    expect(nodeAt(state.nodes, 6, 5)?.charge).toBe(1);
    expect(worm.dh).toBe(-1);
    expect(head(state)).toEqual([5, 6]);
  });

  it("charges nothing when the side edge or another segment turned it", () => {
    const state = playingState();
    const worm = poseWorm(state, COLS - 1, 5);
    stepWorm(state, worm, noCues());
    expect(state.nodes).toHaveLength(0);
    expect(worm.dh).toBe(-1);
    expect(head(state)).toEqual([COLS - 1, 6]);

    const blocked = playingState();
    const mover = poseWorm(blocked, 5, 5);
    poseWorm(blocked, 6, 5);
    stepWorm(blocked, mover, noCues());
    expect(blocked.nodes).toHaveLength(0);
    expect(head(blocked)).toEqual([5, 6]);
  });

  it("caps a bumped node at the critical charge", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, 5);
    putNode(state, 6, 5, 2);
    const cues = noCues();
    stepWorm(state, worm, cues);
    expect(nodeAt(state.nodes, 6, 5)?.charge).toBe(3);
    expect(cues.critical).toBe(true);
    expect(worm.diving).toBe(false);
  });

  it("flips its descent at the floor and at the entry row", () => {
    const floor = playingState();
    const down = poseWorm(floor, 5, 19, 1, 1, 1);
    putNode(floor, 6, 19, 0);
    stepWorm(floor, down, noCues());
    expect(down.dv).toBe(-1);
    expect(head(floor)).toEqual([5, 18]);

    const top = playingState();
    const up = poseWorm(top, 5, 0, 1, 1, -1);
    putNode(top, 6, 0, 0);
    stepWorm(top, up, noCues());
    expect(up.dv).toBe(1);
    expect(head(top)).toEqual([5, 1]);
  });

  it("drops through whatever stands in the tile below", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, 5);
    putNode(state, 6, 5, 0);
    putNode(state, 5, 6, 2);
    stepWorm(state, worm, noCues());
    expect(head(state)).toEqual([5, 6]);
    expect(nodeAt(state.nodes, 5, 6)?.charge).toBe(2);
  });

  it("holds the body where it stands when the body's follow is held", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, 5, 3);
    worm.body = false;
    stepWorm(state, worm, noCues());
    expect(worm.segments.map((s) => [s.c, s.r])).toEqual([
      [6, 5],
      [4, 5],
      [3, 5],
    ]);
  });
});

describe("diving", () => {
  it("starts on a block by a critical node above the band", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, 5);
    putNode(state, 6, 5, 3);
    stepWorm(state, worm, noCues());
    expect(worm.diving).toBe(true);
    expect(worm.dh).toBe(1);
    expect(head(state)).toEqual([5, 6]);
    expect(nodeAt(state.nodes, 6, 5)?.charge).toBe(3);
  });

  it("drives straight down through whatever it enters", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, 5);
    worm.diving = true;
    putNode(state, 5, 6, 2);
    stepWorm(state, worm, noCues());
    expect(head(state)).toEqual([5, 6]);
    expect(nodeAt(state.nodes, 5, 6)?.charge).toBe(2);
    expect(worm.diving).toBe(true);
  });

  it("ends on the step that reaches the band", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, BAND_TOP_ROW - 1);
    worm.diving = true;
    stepWorm(state, worm, noCues());
    expect(head(state)).toEqual([5, BAND_TOP_ROW]);
    expect(worm.diving).toBe(false);
  });

  it("turns the ordinary way when the critical block comes inside the band", () => {
    const state = playingState();
    const worm = poseWorm(state, 5, BAND_TOP_ROW);
    putNode(state, 6, BAND_TOP_ROW, 3);
    stepWorm(state, worm, noCues());
    expect(worm.diving).toBe(false);
    expect(worm.dh).toBe(-1);
    expect(head(state)).toEqual([5, BAND_TOP_ROW + 1]);
  });
});

describe("cutting the worm", () => {
  it("leaves two worms when a middle segment is removed, the head keeping the id", () => {
    const state = playingState();
    const worm = poseWorm(state, 10, 5, 5);
    const id = worm.id;
    cutWorm(state, worm, new Set([2]));
    expect(state.worms).toHaveLength(2);
    expect(state.worms[0].id).toBe(id);
    expect(state.worms[0].segments.map((s) => s.c)).toEqual([10, 9]);
    expect(state.worms[1].id).not.toBe(id);
    expect(state.worms[1].segments.map((s) => s.c)).toEqual([7, 6]);
    expect(state.worms[1].dh).toBe(worm.dh);
    expect(state.worms[1].dv).toBe(worm.dv);
  });

  it("leaves one shorter worm for the head and for the tail", () => {
    const front = playingState();
    const first = poseWorm(front, 10, 5, 4);
    cutWorm(front, first, new Set([0]));
    expect(front.worms).toHaveLength(1);
    expect(front.worms[0].id).toBe(first.id);
    expect(front.worms[0].segments.map((s) => s.c)).toEqual([9, 8, 7]);

    const back = playingState();
    const second = poseWorm(back, 10, 5, 4);
    cutWorm(back, second, new Set([3]));
    expect(back.worms[0].segments.map((s) => s.c)).toEqual([10, 9, 8]);
  });

  it("removes a worm that lost every segment", () => {
    const state = playingState();
    const worm = poseWorm(state, 10, 5, 2);
    cutWorm(state, worm, new Set([0, 1]));
    expect(state.worms).toHaveLength(0);
  });

  it("gives each further run a fresh id, in order from the head end", () => {
    const state = playingState();
    const worm = poseWorm(state, 12, 5, 7);
    cutWorm(state, worm, new Set([2, 5]));
    expect(state.worms.map((entry) => entry.segments.map((s) => s.c))).toEqual([
      [12, 11],
      [9, 8],
      [6],
    ]);
    const ids = state.worms.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBeLessThan(ids[2]);
  });

  it("inherits the faculties of the worm it came from", () => {
    const state = playingState();
    const worm = poseWorm(state, 10, 5, 5);
    worm.stepping = false;
    cutWorm(state, worm, new Set([2]));
    expect(state.worms[1].stepping).toBe(false);
  });
});

describe("the level's worm", () => {
  it("enters along the entry row at the level's own length", () => {
    for (const level of [1, 6, 12]) {
      const state = playingState();
      state.level = level;
      const worm = enterLevelWorm(state);
      expect(worm.segments).toHaveLength(wormLength(level));
      expect(worm.segments.every((segment) => segment.r === 0)).toBe(true);
      expect(worm.dv).toBe(1);
      const columns = worm.segments.map((segment) => segment.c);
      const tail = columns[columns.length - 1];
      // The head is the segment furthest from the edge it entered at.
      expect(worm.dh > 0 ? tail : COLS - 1 - tail).toBe(0);
      expect(Math.abs(columns[0] - tail)).toBe(wormLength(level) - 1);
    }
  });
});
