// The obstacle motion specs/playfield.md fixes, checked against the pose
// functions directly. Everything here is a pure call: no runtime, no canvas.

import { describe, expect, it } from "vitest";
import {
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  OBSTACLE_CENTERS,
  OBSTACLE_HH,
  OBSTACLE_HW,
  OBSTACLE_SPIN_RATE,
  OBSTACLE_SWAY_AMP,
  OBSTACLE_SWAY_PERIOD,
} from "./constants";
import {
  fullField,
  isObstacleIndex,
  obstaclePose,
  placeObstacle,
  poseObstacles,
  spinAngle,
  swayOffset,
} from "./obstacles";
import type { ObstacleState } from "./game";

describe("sway", () => {
  it("starts both obstacles upright at their base centers", () => {
    for (const [i, base] of OBSTACLE_CENTERS.entries()) {
      const pose = obstaclePose(i, 0);
      expect(pose.index).toBe(i);
      expect(pose.cx).toBeCloseTo(base.x, 9);
      expect(pose.cy).toBeCloseTo(base.y, 9);
      expect(pose.theta).toBeCloseTo(0, 9);
    }
  });

  it("reaches full amplitude a quarter period in, in opposite directions", () => {
    const t = OBSTACLE_SWAY_PERIOD / 4;
    const a = obstaclePose(0, t);
    const b = obstaclePose(1, t);
    expect(a.cy).toBeCloseTo(OBSTACLE_CENTERS[0]!.y + OBSTACLE_SWAY_AMP, 6);
    expect(b.cy).toBeCloseTo(OBSTACLE_CENTERS[1]!.y - OBSTACLE_SWAY_AMP, 6);
  });

  it("never moves an obstacle horizontally", () => {
    for (let t = 0; t < 2 * OBSTACLE_SWAY_PERIOD; t += 0.05) {
      for (const [i, base] of OBSTACLE_CENTERS.entries()) {
        expect(obstaclePose(i, t).cx).toBeCloseTo(base.x, 9);
      }
    }
  });

  it("returns to the base centers after a full period", () => {
    for (const [i, base] of OBSTACLE_CENTERS.entries()) {
      expect(obstaclePose(i, OBSTACLE_SWAY_PERIOD).cy).toBeCloseTo(base.y, 6);
    }
  });

  it("keeps the layout point-symmetric about the field center at every instant", () => {
    // Whatever A is doing on one side of the center, B mirrors through it — so
    // neither player ever faces the busier half of the field.
    for (let t = 0; t < 2 * OBSTACLE_SWAY_PERIOD; t += 0.03) {
      const a = obstaclePose(0, t);
      const b = obstaclePose(1, t);
      expect((a.cx + b.cx) / 2).toBeCloseTo(FIELD_CX, 6);
      expect((a.cy + b.cy) / 2).toBeCloseTo(FIELD_CY, 6);
    }
  });

  it("keeps both obstacles clear of the top and bottom walls even at full tilt", () => {
    // At full tilt the bar's vertical reach is its half-diagonal, so this is the
    // worst case over every angle as well as every sway offset.
    const reach = Math.hypot(OBSTACLE_HW, OBSTACLE_HH);
    for (let t = 0; t < 2 * OBSTACLE_SWAY_PERIOD; t += 0.02) {
      for (let i = 0; i < OBSTACLE_CENTERS.length; i++) {
        const { cy } = obstaclePose(i, t);
        expect(cy - reach).toBeGreaterThan(0);
        expect(cy + reach).toBeLessThan(FIELD_H);
      }
    }
  });

  it("shares one signed offset between the two, added by A and subtracted by B", () => {
    const t = 1.234;
    const offset = swayOffset(t);
    expect(obstaclePose(0, t).cy).toBeCloseTo(
      OBSTACLE_CENTERS[0]!.y + offset,
      9,
    );
    expect(obstaclePose(1, t).cy).toBeCloseTo(
      OBSTACLE_CENTERS[1]!.y - offset,
      9,
    );
  });
});

describe("spin", () => {
  it("turns at the constant rate, the same way for both", () => {
    for (const t of [0.5, 1, 2.75, 6]) {
      expect(spinAngle(t)).toBeCloseTo(OBSTACLE_SPIN_RATE * t, 9);
      expect(obstaclePose(0, t).theta).toBeCloseTo(OBSTACLE_SPIN_RATE * t, 9);
      expect(obstaclePose(1, t).theta).toBeCloseTo(OBSTACLE_SPIN_RATE * t, 9);
    }
  });

  it("turns a quarter turn in the time 60 deg/s needs for one", () => {
    // A sanity check on the UNIT: the rate is radians per second, so three
    // seconds at 60 deg/s is half a turn.
    expect(spinAngle(3)).toBeCloseTo(Math.PI, 9);
  });

  it("is a pure function of the clock, never an integration", () => {
    // Reading the same clock twice gives the same pose, whatever happened in
    // between — which is what makes a posed clock hold its pose.
    expect(obstaclePose(0, 1.5)).toEqual(obstaclePose(0, 1.5));
  });
});

describe("poseObstacles", () => {
  it("writes each present pose in place, keeping the objects it was given", () => {
    const field = fullField(0);
    const first = field[0];
    poseObstacles(field, 1.1);
    expect(field[0]).toBe(first);
    expect(field[0]).toEqual(obstaclePose(0, 1.1));
    expect(field[1]).toEqual(obstaclePose(1, 1.1));
  });

  it("re-poses only what is on the field, and puts nothing back", () => {
    // An absent obstacle stays absent: which obstacles are there is `clearWorld`
    // and `spawnObstacle`'s business (specs/instrumentation.md).
    const field: ObstacleState[] = [obstaclePose(1, 0)];
    poseObstacles(field, 0.9);
    expect(field).toHaveLength(1);
    expect(field[0]).toEqual(obstaclePose(1, 0.9));

    const empty: ObstacleState[] = [];
    poseObstacles(empty, 0.4);
    expect(empty).toEqual([]);
  });
});

describe("placeObstacle", () => {
  it("spawns into an empty field at the clock's pose", () => {
    const field: ObstacleState[] = [];
    placeObstacle(field, 1, 0.7);
    expect(field).toEqual([obstaclePose(1, 0.7)]);
  });

  it("keeps the field in the order of OBSTACLE_CENTERS", () => {
    const field: ObstacleState[] = [];
    placeObstacle(field, 1, 0);
    placeObstacle(field, 0, 0);
    expect(field.map((o) => o.index)).toEqual([0, 1]);
  });

  it("returns an obstacle already there to the arrangement its row states", () => {
    const field = fullField(0);
    field[0].cy = -999;
    placeObstacle(field, 0, 0);
    expect(field).toHaveLength(2);
    expect(field[0]).toEqual(obstaclePose(0, 0));
  });
});

describe("range", () => {
  it("refuses an obstacle index that does not exist", () => {
    expect(() => obstaclePose(2, 0)).toThrow(RangeError);
  });

  it("names the indices this field carries", () => {
    expect(isObstacleIndex(0)).toBe(true);
    expect(isObstacleIndex(OBSTACLE_CENTERS.length - 1)).toBe(true);
    expect(isObstacleIndex(OBSTACLE_CENTERS.length)).toBe(false);
    expect(isObstacleIndex(-1)).toBe(false);
    expect(isObstacleIndex(0.5)).toBe(false);
  });
});
