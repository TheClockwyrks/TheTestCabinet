// Spectra — the curved paths, addressed by arc length.

import { describe, expect, it } from "vitest";
import { Path, smoothPath } from "./paths";

describe("smoothPath", () => {
  it("measures a straight run's length exactly", () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(path.length).toBeCloseTo(100, 6);
    expect(path.at(50)).toMatchObject({ y: 0 });
    expect(path.at(50).x).toBeCloseTo(50, 6);
  });

  it("advances at a constant speed along a curve", () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 120, y: 200 },
      { x: 300, y: 40 },
      { x: 500, y: 300 },
    ]);
    const step = path.length / 40;
    let previous = path.at(0);
    const steps: number[] = [];
    for (let index = 1; index <= 40; index += 1) {
      const now = path.at(index * step);
      steps.push(Math.hypot(now.x - previous.x, now.y - previous.y));
      previous = now;
    }
    const mean = steps.reduce((sum, one) => sum + one, 0) / steps.length;
    for (const one of steps)
      expect(Math.abs(one - mean)).toBeLessThan(mean * 0.2);
  });

  it("flows through every knot", () => {
    const knots = [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 240, y: 10 },
    ];
    const path = smoothPath(knots);
    // Every knot is within a sample's reach of some point on the path.
    for (const knot of knots) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let d = 0; d <= path.length; d += path.length / 200) {
        const point = path.at(d);
        nearest = Math.min(
          nearest,
          Math.hypot(point.x - knot.x, point.y - knot.y),
        );
      }
      expect(nearest).toBeLessThan(2);
    }
  });

  it("clamps to both ends outside its own span", () => {
    const path = smoothPath([
      { x: 10, y: 10 },
      { x: 40, y: 10 },
    ]);
    expect(path.at(-100)).toMatchObject({ x: 10, y: 10 });
    expect(path.at(1e6).x).toBeCloseTo(40, 6);
  });

  it("bounds every sample at a stated ceiling", () => {
    const path = smoothPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 400 },
        { x: 200, y: 0 },
      ],
      { maxY: 200 },
    );
    for (let d = 0; d <= path.length; d += path.length / 100) {
      expect(path.at(d).y).toBeLessThanOrEqual(200 + 1e-9);
    }
  });

  it("survives a degenerate chain of knots", () => {
    expect(smoothPath([]).at(0)).toMatchObject({ x: 0, y: 0 });
    expect(smoothPath([{ x: 5, y: 6 }]).at(10)).toMatchObject({ x: 5, y: 6 });
    expect(new Path([]).at(3)).toMatchObject({ x: 0, y: 0 });
  });
});
