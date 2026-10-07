// The channel's geometry: the twelve vertices, the arc distances they imply, and
// the point and forward direction an arc position gives.

import { describe, expect, it } from "vitest";
import { CHANNEL, PATH_LENGTH } from "./constants";
import { INLET, INTAKE, LEGS, forwardAt, legAt, pointAt } from "./channel";

describe("the legs", () => {
  it("derives one leg per pair of vertices, ending at the stated arc length", () => {
    expect(LEGS).toHaveLength(CHANNEL.length - 1);
    const total = LEGS.reduce((sum, leg) => sum + leg.length, 0);
    expect(total).toBeCloseTo(PATH_LENGTH, 6);
  });

  it("carries the arc distance the specification tabulates at each vertex", () => {
    const expected = [
      0, 880, 1340, 2140, 2520, 3240, 3540, 4160, 4360, 4760, 4860,
    ];
    LEGS.forEach((leg, index) => {
      expect(leg.at).toBeCloseTo(expected[index], 6);
      expect(leg.x).toBe(CHANNEL[index].x);
      expect(leg.y).toBe(CHANNEL[index].y);
      expect(Math.hypot(leg.dx, leg.dy)).toBeCloseTo(1, 12);
    });
  });
});

describe("an arc position", () => {
  it("walks the polyline to the point the specification names", () => {
    const table: [number, number, number][] = [
      [0, 40, 40],
      [880, 920, 40],
      [1340, 920, 500],
      [2140, 120, 500],
      [2520, 120, 120],
      [3240, 840, 120],
      [3540, 840, 420],
      [4160, 220, 420],
      [4360, 220, 220],
      [4760, 620, 220],
      [4860, 620, 320],
      [4990, 490, 320],
      [PATH_LENGTH, 480, 320],
    ];
    for (const [s, x, y] of table) {
      const point = pointAt(s);
      expect(point.x).toBeCloseTo(x, 6);
      expect(point.y).toBeCloseTo(y, 6);
    }
  });

  it("draws a core below zero at the inlet, on the first leg", () => {
    expect(pointAt(-50)).toEqual(INLET);
    expect(legAt(-50)).toBe(LEGS[0]);
    expect(forwardAt(-50)).toEqual({ x: 1, y: 0 });
  });

  it("takes the final leg's direction at the intake", () => {
    expect(INTAKE).toEqual({ x: 480, y: 320 });
    expect(forwardAt(PATH_LENGTH)).toEqual({ x: -1, y: 0 });
  });

  it("takes the direction of the leg beginning at a vertex", () => {
    // Vertex 1 at arc 880 turns the run from +x to +y.
    expect(forwardAt(880)).toEqual({ x: 0, y: 1 });
    expect(forwardAt(879.9)).toEqual({ x: 1, y: 0 });
  });
});
