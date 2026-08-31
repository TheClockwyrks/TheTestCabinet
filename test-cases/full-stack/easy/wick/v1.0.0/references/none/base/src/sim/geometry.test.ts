import { describe, expect, it } from "vitest";
import {
  circlesOverlap,
  direction,
  fromDegrees,
  rectCircleOverlap,
  rotate,
  unit,
} from "./geometry";

describe("geometry", () => {
  it("normalizes and refuses a zero vector", () => {
    expect(unit({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(unit({ x: 0, y: 0 })).toBeNull();
    expect(direction({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
    expect(direction({ x: 0, y: 0 }, { x: 0, y: -2 })).toEqual({ x: 0, y: -1 });
  });

  it("overlaps circles strictly", () => {
    expect(circlesOverlap({ x: 0, y: 0 }, 10, { x: 19.9, y: 0 }, 10)).toBe(
      true,
    );
    expect(circlesOverlap({ x: 0, y: 0 }, 10, { x: 20, y: 0 }, 10)).toBe(false);
  });

  it("overlaps a rectangle and a circle by the nearest point", () => {
    const center = { x: 60, y: 0 };
    expect(rectCircleOverlap(center, 120, 40, { x: 125, y: 0 }, 6)).toBe(true);
    expect(rectCircleOverlap(center, 120, 40, { x: 126, y: 0 }, 6)).toBe(false);
    expect(rectCircleOverlap(center, 120, 40, { x: 60, y: 25 }, 6)).toBe(true);
    expect(rectCircleOverlap(center, 120, 40, { x: 60, y: 26 }, 6)).toBe(false);
  });

  it("turns angles clockwise on screen", () => {
    const down = fromDegrees(90);
    expect(down.x).toBeCloseTo(0);
    expect(down.y).toBeCloseTo(1);
    const turned = rotate({ x: 1, y: 0 }, 90);
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(1);
  });
});
