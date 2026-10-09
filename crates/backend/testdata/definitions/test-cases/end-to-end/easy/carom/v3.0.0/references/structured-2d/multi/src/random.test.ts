// The launch angle is the whole of Carom's randomness, so what is checked here
// is the draw's range and that it covers the circle, not any particular sequence.

import { describe, expect, it } from "vitest";
import { drawLaunchAngle } from "./random";

describe("drawLaunchAngle", () => {
  it("stays inside [0, 2 * PI)", () => {
    for (let i = 0; i < 200; i++) {
      const angle = drawLaunchAngle();
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
    }
  });

  it("reaches every quadrant over a run of draws", () => {
    const quadrants = new Set<number>();
    for (let i = 0; i < 400; i++) {
      quadrants.add(Math.floor(drawLaunchAngle() / (Math.PI / 2)));
    }
    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });
});
