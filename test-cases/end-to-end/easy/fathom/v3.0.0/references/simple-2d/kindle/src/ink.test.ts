import { describe, expect, it } from "vitest";
import { INK_LIFE, INK_RADIUS } from "./constants";
import { ageInk, inkBlinds, inkCovers, inkCrosses, releaseInk } from "./ink";

describe("an ink cloud", () => {
  it("stands where it was released, for its whole life", () => {
    const cloud = releaseInk(400, 300);
    expect(cloud).toEqual({
      x: 400,
      y: 300,
      radius: INK_RADIUS,
      remaining: INK_LIFE,
    });
  });

  it("runs down and leaves the board when it is spent", () => {
    let clouds = [releaseInk(400, 300)];
    clouds = [...ageInk(clouds, INK_LIFE - 0.5)];
    expect(clouds).toHaveLength(1);
    expect(clouds[0].remaining).toBeCloseTo(0.5);
    expect(ageInk(clouds, 0.5)).toHaveLength(0);
  });

  it("covers what stands inside it and nothing outside it", () => {
    const clouds = [releaseInk(400, 300)];
    expect(inkCovers(clouds, 400, 300 + INK_RADIUS - 1)).toBe(true);
    expect(inkCovers(clouds, 400, 300 + INK_RADIUS + 1)).toBe(false);
  });

  it("blinds a hunter the cloud stands between, not one it stands wide of", () => {
    const clouds = [releaseInk(400, 300)];
    expect(inkCrosses(clouds, 200, 300, 600, 300)).toBe(true);
    expect(
      inkCrosses(clouds, 200, 300 + INK_RADIUS + 4, 600, 300 + INK_RADIUS + 4),
    ).toBe(false);
    expect(inkBlinds(clouds, 400, 300, 900, 300)).toBe(true);
    expect(inkBlinds(clouds, 900, 700, 950, 700)).toBe(false);
  });
});
