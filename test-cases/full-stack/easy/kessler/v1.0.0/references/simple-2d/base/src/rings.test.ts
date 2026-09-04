// The ring figures and slot-arc geometry of specs/rings.md: slot layout, the
// 2-degree structural gaps, inclusive arc membership, and the wave formulas.

import { describe, expect, it } from "vitest";
import { RINGS, ballSpeedForWave } from "./figures";
import {
  arcCenterDeg,
  arcCenterRelDeg,
  filledRing,
  filledRings,
  liveTargetAtRel,
  liveTargetCount,
  withinArcRel,
} from "./rings";

describe("the ring figures", () => {
  it("carries the slot counts, widths, arcs, and hit points of the table", () => {
    expect(RINGS.map((r) => r.slots)).toEqual([12, 16, 20]);
    expect(RINGS.map((r) => r.slotWidthDeg)).toEqual([30, 22.5, 18]);
    expect(RINGS.map((r) => r.arcDeg)).toEqual([26, 18.5, 14]);
    expect(RINGS.map((r) => r.hitPoints)).toEqual([1, 2, 1]);
    expect(RINGS.map((r) => r.destroyScore)).toEqual([100, 200, 300]);
  });

  it("slots cover the full circle", () => {
    for (const spec of RINGS) {
      expect(spec.slots * spec.slotWidthDeg).toBe(360);
    }
  });

  it("follows the orbit-speed formulas with their caps", () => {
    expect(RINGS[0].speedForWave(1)).toBe(0);
    expect(RINGS[0].speedForWave(9)).toBe(0);
    expect(RINGS[1].speedForWave(1)).toBe(12);
    expect(RINGS[1].speedForWave(2)).toBe(15);
    expect(RINGS[1].speedForWave(50)).toBe(45);
    expect(RINGS[2].speedForWave(1)).toBe(-8);
    expect(RINGS[2].speedForWave(3)).toBe(-12);
    expect(RINGS[2].speedForWave(50)).toBe(-30);
  });

  it("follows the ball-speed formula with its cap", () => {
    expect(ballSpeedForWave(1)).toBe(240);
    expect(ballSpeedForWave(2)).toBe(270);
    expect(ballSpeedForWave(9)).toBe(480);
    expect(ballSpeedForWave(20)).toBe(480);
  });
});

describe("slot arcs", () => {
  it("begin 2 degrees into the slot: ring 1 slot 0 centers at 15", () => {
    expect(arcCenterRelDeg(RINGS[0], 0)).toBe(15);
    expect(arcCenterRelDeg(RINGS[0], 1)).toBe(45);
    expect(arcCenterRelDeg(RINGS[1], 0)).toBe(2 + 18.5 / 2);
  });

  it("ride the ring's angle on the stage", () => {
    expect(arcCenterDeg(RINGS[0], 0, 90)).toBe(105);
  });

  it("include both arc boundaries", () => {
    // Ring 1 slot 0 spans [2, 28].
    expect(withinArcRel(RINGS[0], 2, 0)).toBe(true);
    expect(withinArcRel(RINGS[0], 28, 0)).toBe(true);
    expect(withinArcRel(RINGS[0], 1.99, 0)).toBe(false);
    expect(withinArcRel(RINGS[0], 28.01, 0)).toBe(false);
  });

  it("leave a 2-degree structural gap at each side of the slot", () => {
    // Between slot 0's arc end at 28 and slot 1's start at 32.
    expect(withinArcRel(RINGS[0], 30, 0)).toBe(false);
    expect(withinArcRel(RINGS[0], 30, 1)).toBe(false);
    expect(withinArcRel(RINGS[0], 32, 1)).toBe(true);
  });
});

describe("ring state", () => {
  it("fills every slot at full hit points, at ring angle 0", () => {
    const ring = filledRing(RINGS[1], 1);
    expect(ring.angleDeg).toBe(0);
    expect(ring.speedDegPerSec).toBe(12);
    expect(ring.targets).toHaveLength(16);
    expect(ring.targets.every((hp) => hp === 2)).toBe(true);
  });

  it("finds the live target under a relative angle, gaps excluded", () => {
    const ring = filledRing(RINGS[0], 1);
    expect(liveTargetAtRel(RINGS[0], ring, 15)).toBe(0);
    expect(liveTargetAtRel(RINGS[0], ring, 45)).toBe(1);
    expect(liveTargetAtRel(RINGS[0], ring, 0.5)).toBeNull();
    ring.targets[1] = null;
    expect(liveTargetAtRel(RINGS[0], ring, 45)).toBeNull();
  });

  it("wraps relative angles when looking targets up", () => {
    const ring = filledRing(RINGS[0], 1);
    expect(liveTargetAtRel(RINGS[0], ring, 15 - 360)).toBe(0);
  });

  it("counts live targets across the three rings", () => {
    const rings = filledRings(1);
    expect(liveTargetCount(rings)).toBe(12 + 16 + 20);
    rings[0].targets[0] = null;
    expect(liveTargetCount(rings)).toBe(47);
  });
});
