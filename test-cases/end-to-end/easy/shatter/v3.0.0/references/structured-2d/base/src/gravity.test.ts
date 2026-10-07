import { describe, expect, it } from "vitest";
import { MU, SOFTEN, STAR_X, STAR_Y } from "./constants";
import { gravityAccel } from "./gravity";

/** The magnitude the specification's own table states at a distance. */
function stated(d: number): number {
  const dEff = Math.max(d, SOFTEN);
  return MU / (dEff * dEff);
}

describe("the pull law", () => {
  it("follows the inverse square outside the softening radius", () => {
    for (const d of [200, 150, 120]) {
      const { ax, ay } = gravityAccel(STAR_X + d, STAR_Y);
      expect(Math.hypot(ax, ay)).toBeCloseTo(stated(d), 6);
    }
    expect(stated(200)).toBeCloseTo(112.5, 6);
    expect(stated(150)).toBeCloseTo(200, 6);
    expect(stated(120)).toBeCloseTo(312.5, 6);
  });

  it("is capped inside the softening radius", () => {
    const capped = MU / (SOFTEN * SOFTEN);
    for (const d of [90, 60, 31]) {
      const { ax, ay } = gravityAccel(STAR_X, STAR_Y + d);
      expect(Math.hypot(ax, ay)).toBeCloseTo(capped, 6);
    }
    expect(capped).toBeCloseTo(555.5555, 3);
  });

  it("points at the star's centre from every bearing", () => {
    for (const bearing of [0, Math.PI / 3, Math.PI, -Math.PI / 2]) {
      const x = STAR_X + Math.cos(bearing) * 240;
      const y = STAR_Y + Math.sin(bearing) * 240;
      const { ax, ay } = gravityAccel(x, y);
      const toStar = Math.atan2(STAR_Y - y, STAR_X - x);
      expect(Math.atan2(ay, ax)).toBeCloseTo(toStar, 9);
    }
  });

  it("uses the direct vector rather than a wrapped one", () => {
    // Forty units inside a corner: the direct distance across the field is far
    // larger than the distance to the star's nearest wrapped image.
    const direct = Math.hypot(STAR_X - 40, STAR_Y - 40);
    const { ax, ay } = gravityAccel(40, 40);
    expect(Math.hypot(ax, ay)).toBeCloseTo(stated(direct), 6);
    // Toward the centre of the field, which is down and to the right.
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeGreaterThan(0);
  });

  it("gives a body sitting on the star nothing to fall along", () => {
    expect(gravityAccel(STAR_X, STAR_Y)).toEqual({ ax: 0, ay: 0 });
  });
});
