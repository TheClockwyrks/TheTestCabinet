import { describe, expect, it } from "vitest";
import { CHANNEL, PATH_LENGTH } from "./constants";
import { INLET, INTAKE, LEGS, forwardAt, legAt, pointAt } from "./channel";

describe("the channel", () => {
  it("derives eleven legs whose arc distances match the specification", () => {
    expect(LEGS).toHaveLength(CHANNEL.length - 1);
    expect(LEGS.map((leg) => leg.at)).toEqual([
      0, 880, 1340, 2140, 2520, 3240, 3540, 4160, 4360, 4760, 4860,
    ]);
    expect(LEGS.map((leg) => leg.length)).toEqual([
      880, 460, 800, 380, 720, 300, 620, 200, 400, 100, 140,
    ]);
  });

  it("walks the whole channel in PATH_LENGTH units", () => {
    const total = LEGS.reduce((sum, leg) => sum + leg.length, 0);
    expect(total).toBe(PATH_LENGTH);
  });

  it("maps an arc distance to the point the polyline gives", () => {
    const cases: [number, number, number][] = [
      [0, 40, 40],
      [880, 920, 40],
      [1340, 920, 500],
      [3240, 840, 120],
      [4360, 220, 220],
      [4990, 490, 320],
      [PATH_LENGTH, 480, 320],
    ];
    for (const [s, x, y] of cases) {
      const point = pointAt(s);
      expect(point.x).toBeCloseTo(x, 6);
      expect(point.y).toBeCloseTo(y, 6);
    }
  });

  it("draws a core carried below zero at the inlet", () => {
    expect(pointAt(-40)).toEqual(INLET);
    expect(forwardAt(-40)).toEqual({ x: 1, y: 0 });
    expect(legAt(-40)).toBe(LEGS[0]);
  });

  it("reports the direction of the leg a position begins", () => {
    expect(forwardAt(0)).toEqual({ x: 1, y: 0 });
    expect(forwardAt(880)).toEqual({ x: 0, y: 1 });
    expect(forwardAt(1340)).toEqual({ x: -1, y: 0 });
    // At the very end the forward is the final leg's.
    expect(forwardAt(PATH_LENGTH)).toEqual({ x: -1, y: 0 });
  });

  it("stands the inlet at the start and the intake at the end", () => {
    expect(INLET).toEqual({ x: 40, y: 40 });
    expect(INTAKE).toEqual({ x: 480, y: 320 });
  });
});
