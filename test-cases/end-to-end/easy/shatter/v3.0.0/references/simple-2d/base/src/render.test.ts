// The one piece of drawing that is arithmetic: a round's tail.
//
// The tail is derived from the round's own motion rather than stored, so it is
// checkable on its own: it spans TRAIL_TICKS of the round's current travel, it
// is one continuous run of points, and no part of it is further from the round
// than that span.

import { describe, expect, it } from "vitest";
import { BULLET_LIFE, STAR_X, STAR_Y, TICK_DT, TRAIL_TICKS } from "./constants";
import { bulletTrail } from "./render";
import type { BulletState } from "./game";

function round(x: number, y: number, vx: number, vy: number): BulletState {
  return { id: 1, x, y, vx, vy, life: BULLET_LIFE };
}

/** How far the tail's oldest point is from the round it belongs to. */
function span(path: readonly (readonly [number, number])[]): number {
  const tip = path[path.length - 1];
  return Math.hypot(tip[0] - path[0][0], tip[1] - path[0][1]);
}

describe("a round's tail", () => {
  it("starts at the round and runs back from it", () => {
    const bullet = round(300, 100, 520, 0);
    const path = bulletTrail(bullet);
    expect(path[0]).toEqual([300, 100]);
    expect(path.length).toBeGreaterThan(2);
    expect(path[path.length - 1][0]).toBeLessThan(300);
  });

  it("spans the round's own travel over TRAIL_TICKS", () => {
    const slow = bulletTrail(round(300, 100, 200, 0));
    const fast = bulletTrail(round(300, 100, 400, 0));
    // The arc the well bent the round along is a hair longer than the straight
    // line back to its oldest point, so the span sits just under the budget.
    const budget = 200 * TRAIL_TICKS * TICK_DT;
    expect(span(slow)).toBeLessThanOrEqual(budget + 1e-9);
    expect(span(slow)).toBeGreaterThan(budget * 0.95);
    expect(span(fast) / span(slow)).toBeCloseTo(2, 1);
  });

  it("never reaches further from the round than that span", () => {
    // Close to the star, where the well was speeding the round up hardest.
    const bullet = round(STAR_X, STAR_Y - 95, 0, -600);
    const budget = 600 * TRAIL_TICKS * TICK_DT;
    for (const [x, y] of bulletTrail(bullet)) {
      expect(Math.hypot(x - bullet.x, y - bullet.y)).toBeLessThanOrEqual(
        budget + 1e-9,
      );
    }
  });

  it("bends the way the well bent the round", () => {
    const bullet = round(STAR_X + 120, STAR_Y, 0, -520);
    const path = bulletTrail(bullet);
    const straight = path[path.length - 1][0] === bullet.x;
    expect(straight).toBe(false);
  });

  it("is nothing at all for a round at rest", () => {
    expect(bulletTrail(round(100, 100, 0, 0))).toHaveLength(1);
  });
});
