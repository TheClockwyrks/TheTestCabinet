// The worm's chain: how a level lays one down, and what is left when segments
// are taken out of it.

import { describe, expect, it } from "vitest";
import { COLS, wormLength } from "./constants";
import { blankState } from "./flow";
import { addWorm, enterWorm, segmentAt, splitWorm } from "./worm";
import { toSim, type Sim } from "./sim";

function sim(): Sim {
  return toSim(blankState());
}

/** A worm of `length` segments running left from `(c, r)`. */
function lay(s: Sim, c: number, r: number, length: number): number {
  const worm = addWorm(s, c, r);
  for (let i = 1; i < length; i++) worm.segments.push({ c: c - i, r });
  return worm.id;
}

describe("entry", () => {
  it("lays the level's length along the entry row, heading inward", () => {
    for (const level of [1, 1, 6, 12] as const) {
      const s = sim();
      s.level = level;
      const worm = enterWorm(s);
      expect(worm.segments).toHaveLength(wormLength(level));
      expect(worm.segments.every((tile) => tile.r === 0)).toBe(true);
      expect(worm.dv).toBe(1);
      expect(Math.abs(worm.dh)).toBe(1);

      const head = worm.segments[0];
      const tail = worm.segments[worm.segments.length - 1];
      if (worm.dh === 1) {
        // Entering from the left: the head leads, deepest into the board.
        expect(tail?.c).toBe(0);
        expect(head?.c).toBe(wormLength(level) - 1);
      } else {
        expect(tail?.c).toBe(COLS - 1);
        expect(head?.c).toBe(COLS - wormLength(level));
      }
    }
  });

  it("enters from both edges across draws", () => {
    const headings = new Set<number>();
    for (let draw = 1; draw <= 60; draw++) {
      const s = sim();
      headings.add(enterWorm(s).dh);
    }
    expect(headings).toEqual(new Set([-1, 1]));
  });

  it("enters at a posed edge, which that entry consumes", () => {
    for (const edge of ["left", "right"] as const) {
      const s = sim();
      s.nextWormEntry = edge;
      const worm = enterWorm(s);
      const tail = worm.segments[worm.segments.length - 1];
      expect(worm.dh).toBe(edge === "left" ? 1 : -1);
      expect(tail?.c).toBe(edge === "left" ? 0 : COLS - 1);
      expect(s.nextWormEntry).toBeNull();
    }
  });
});

describe("occupancy", () => {
  it("reports a tile any worm stands on", () => {
    const s = sim();
    lay(s, 10, 4, 3);
    expect(segmentAt(s, 10, 4)).toBe(true);
    expect(segmentAt(s, 8, 4)).toBe(true);
    expect(segmentAt(s, 7, 4)).toBe(false);
  });
});

describe("cutting the chain", () => {
  it("leaves one worm, one shorter, on a tail hit", () => {
    const s = sim();
    const id = lay(s, 10, 4, 4);
    splitWorm(s, s.worms[0]!, new Set([3]));
    expect(s.worms).toHaveLength(1);
    expect(s.worms[0]?.id).toBe(id);
    expect(s.worms[0]?.segments).toHaveLength(3);
  });

  it("leaves the second segment leading on a head hit, keeping the id", () => {
    const s = sim();
    const id = lay(s, 10, 4, 3);
    splitWorm(s, s.worms[0]!, new Set([0]));
    expect(s.worms).toHaveLength(1);
    expect(s.worms[0]?.id).toBe(id);
    expect(s.worms[0]?.segments[0]).toEqual({ c: 9, r: 4 });
  });

  it("leaves two worms on a middle hit, the head-side one keeping the id", () => {
    const s = sim();
    const id = lay(s, 10, 4, 5);
    s.worms[0]!.dh = -1;
    s.worms[0]!.diving = true;
    splitWorm(s, s.worms[0]!, new Set([2]));
    expect(s.worms).toHaveLength(2);
    expect(s.worms[0]?.id).toBe(id);
    expect(s.worms[0]?.segments).toHaveLength(2);
    expect(s.worms[1]?.id).not.toBe(id);
    expect(s.worms[1]?.segments).toHaveLength(2);
    // A new run carries the headings and the diving flag it came from, and
    // starts its own step clock.
    expect(s.worms[1]?.dh).toBe(-1);
    expect(s.worms[1]?.diving).toBe(true);
    expect(s.worms[1]?.stepClock).toBe(0);
  });

  it("appends the further runs in order from the head end", () => {
    const s = sim();
    lay(s, 10, 4, 7);
    splitWorm(s, s.worms[0]!, new Set([2, 4]));
    expect(s.worms).toHaveLength(3);
    expect(s.worms[0]?.segments.map((t) => t.c)).toEqual([10, 9]);
    expect(s.worms[1]?.segments.map((t) => t.c)).toEqual([7]);
    expect(s.worms[2]?.segments.map((t) => t.c)).toEqual([5, 4]);
    expect(s.worms[1]!.id).toBeLessThan(s.worms[2]!.id);
  });

  it("takes a worm off the roster when every segment goes", () => {
    const s = sim();
    lay(s, 10, 4, 2);
    splitWorm(s, s.worms[0]!, new Set([0, 1]));
    expect(s.worms).toHaveLength(0);
  });
});
