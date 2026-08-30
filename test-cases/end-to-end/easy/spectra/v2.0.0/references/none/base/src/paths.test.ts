import { describe, expect, it } from "vitest";

import { Path, smoothPath } from "./paths";

describe("a path", () => {
  it("measures a straight line's arc length", () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(path.length).toBeCloseTo(100, 4);
  });

  it("is travelled at a constant speed along its length", () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 200, y: 300 },
      { x: 500, y: 100 },
      { x: 700, y: 400 },
    ]);
    // Equal steps of arc length cover equal straight-line distance, to the
    // sampling's own resolution.
    const step = path.length / 40;
    const gaps: number[] = [];
    let previous = path.at(0);
    for (let i = 1; i <= 40; i += 1) {
      const point = path.at(i * step);
      gaps.push(Math.hypot(point.x - previous.x, point.y - previous.y));
      previous = point;
    }
    const smallest = Math.min(...gaps);
    const largest = Math.max(...gaps);
    expect(largest - smallest).toBeLessThan(step * 0.12);
  });

  it("clamps to its two ends", () => {
    const path = smoothPath([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
    ]);
    expect(path.at(-50)).toEqual({ x: 10, y: 20 });
    expect(path.at(path.length + 500)).toEqual({ x: 90, y: 20 });
  });

  it("passes through every knot it is given", () => {
    const knots = [
      { x: 0, y: 0 },
      { x: 120, y: 240 },
      { x: 400, y: 60 },
    ];
    const path = smoothPath(knots);
    const start = path.at(0);
    const end = path.at(path.length);
    expect(start.x).toBeCloseTo(0, 4);
    expect(end.x).toBeCloseTo(400, 4);
    // The middle knot is somewhere along the curve.
    let nearest = Infinity;
    for (let d = 0; d <= path.length; d += 1) {
      const point = path.at(d);
      nearest = Math.min(nearest, Math.hypot(point.x - 120, point.y - 240));
    }
    expect(nearest).toBeLessThan(1.5);
  });

  it("is continuous: no step of one unit jumps more than one unit", () => {
    const path = smoothPath([
      { x: 640, y: 140 },
      { x: 780, y: 320 },
      { x: 400, y: 470 },
      { x: 300, y: 580 },
      { x: 520, y: 380 },
    ]);
    let previous = path.at(0);
    for (let d = 1; d <= path.length; d += 1) {
      const point = path.at(d);
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(
        1.4,
      );
      previous = point;
    }
  });

  it("degenerates gracefully with fewer than two knots", () => {
    expect(smoothPath([]).length).toBe(0);
    expect(smoothPath([{ x: 5, y: 6 }]).at(0)).toEqual({ x: 5, y: 6 });
    expect(new Path([]).at(10)).toEqual({ x: 0, y: 0 });
  });
});
