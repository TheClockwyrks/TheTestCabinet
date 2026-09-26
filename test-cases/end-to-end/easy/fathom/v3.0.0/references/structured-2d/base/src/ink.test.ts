import { describe, expect, it } from "vitest";

import { INK_LIFE, INK_RADIUS } from "./constants";
import type { InkCloud } from "./ink";
import { inkBetween, inkCovers, segmentDistance } from "./ink";

function cloud(x: number, y: number): InkCloud {
  return { x, y, radius: INK_RADIUS, remaining: INK_LIFE };
}

describe("an ink cloud", () => {
  it("covers everything inside its radius", () => {
    const clouds = [cloud(400, 300)];
    expect(inkCovers(clouds, 400, 300)).toBe(true);
    expect(inkCovers(clouds, 400 + INK_RADIUS, 300)).toBe(true);
    expect(inkCovers(clouds, 400 + INK_RADIUS + 1, 300)).toBe(false);
  });

  it("covers nothing when none stands", () => {
    expect(inkCovers([], 400, 300)).toBe(false);
    expect(inkBetween([], 0, 0, 100, 100)).toBe(false);
  });

  it("blinds a line that passes within its radius", () => {
    const clouds = [cloud(400, 300)];
    expect(inkBetween(clouds, 200, 300, 600, 300)).toBe(true);
    expect(
      inkBetween(clouds, 200, 300 + INK_RADIUS * 2, 600, 300 + INK_RADIUS * 2),
    ).toBe(false);
  });

  it("measures a line by its nearest point, not by its ends", () => {
    // Both ends are far from the cloud; the segment still runs through it.
    const clouds = [cloud(400, 300)];
    expect(inkBetween(clouds, 100, 300, 700, 300)).toBe(true);
  });

  it("takes the nearer end when the segment stops short", () => {
    expect(segmentDistance(0, 0, 10, 0, 20, 0)).toBe(10);
    expect(segmentDistance(0, 0, -20, 0, -10, 0)).toBe(10);
    expect(segmentDistance(0, 5, -10, 0, 10, 0)).toBe(5);
  });

  it("measures a degenerate segment as a point", () => {
    expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});
