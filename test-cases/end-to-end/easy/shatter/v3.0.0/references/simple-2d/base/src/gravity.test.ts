// The well's law: the magnitude, the softening cap, and the direct vector.

import { describe, expect, it } from "vitest";
import { MU, SOFTEN, STAR_X, STAR_Y } from "./constants";
import { gravityAt } from "./gravity";

describe("the pull", () => {
  it("matches the stated magnitudes", () => {
    const samples: [number, number][] = [
      [200, 112.5],
      [150, 200],
      [120, 312.5],
    ];
    for (const [away, expected] of samples) {
      const [ax, ay] = gravityAt(STAR_X - away, STAR_Y);
      expect(Math.hypot(ax, ay)).toBeCloseTo(expected, 6);
    }
  });

  it("is capped inside the softening radius", () => {
    const cap = MU / (SOFTEN * SOFTEN);
    for (const away of [SOFTEN, 40, 5]) {
      const [ax, ay] = gravityAt(STAR_X, STAR_Y - away);
      expect(Math.hypot(ax, ay)).toBeCloseTo(cap, 6);
    }
  });

  it("points at the star's centre", () => {
    const [ax, ay] = gravityAt(STAR_X - 300, STAR_Y - 400);
    expect(Math.atan2(ay, ax)).toBeCloseTo(Math.atan2(400, 300), 9);
  });

  it("uses the direct vector rather than a wrapped one", () => {
    // A body near the top-left corner is pulled inward, toward the middle of
    // the field, not outward toward a wrapped image of the star.
    const [ax, ay] = gravityAt(10, 10);
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeGreaterThan(0);
  });

  it("adds nothing at the star's own centre", () => {
    expect(gravityAt(STAR_X, STAR_Y)).toEqual([0, 0]);
  });
});
