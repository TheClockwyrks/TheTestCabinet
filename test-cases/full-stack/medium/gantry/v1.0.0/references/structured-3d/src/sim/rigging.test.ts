import { describe, expect, it } from "vitest";
import {
  ATTACH_RADIUS,
  GRAVITY,
  HOIST_CABLE_CAP,
  HOOK_MASS,
  PLACE_POS_TOL,
  PLACE_VEL_TOL,
  PLACE_YAW_TOL,
} from "../constants";
import { DT } from "./axes";
import {
  attachCandidate,
  bobAcceleration,
  bobMass,
  cableSnaps,
  cableTension,
  judgeRelease,
  pendulumStep,
  wrappedYawDifference,
  type RunLoad,
} from "./rigging";
import { length, type Vec3 } from "./vec";

const pivot: Vec3 = [0, 10, 0];

describe("the pendulum tick", () => {
  it("leaves a bob hanging at rest exactly where it hangs", () => {
    const at = pendulumStep(
      { pos: [0, 8, 0], vel: [0, 0, 0] },
      pivot,
      pivot,
      2,
    );
    expect(at.pos[0]).toBeCloseTo(0, 12);
    expect(at.pos[1]).toBeCloseTo(8, 12);
    expect(at.pos[2]).toBeCloseTo(0, 12);
    expect(length(at.vel)).toBeCloseTo(0, 12);
  });

  it("keeps the bob at exactly the cable's length from the pivot", () => {
    let bob = { pos: [1.6, 8.8, 0] as Vec3, vel: [0, 0, 0] as Vec3 };
    for (let i = 0; i < 40; i++) bob = pendulumStep(bob, pivot, pivot, 2);
    expect(length([bob.pos[0], bob.pos[1] - 10, bob.pos[2]])).toBeCloseTo(2, 9);
  });

  it("hangs straight down when the bob coincides with the pivot", () => {
    const at = pendulumStep({ pos: pivot, vel: [0, 0, 0] }, pivot, pivot, 3);
    expect(at.pos[1]).toBeCloseTo(7, 12);
  });

  it("carries the pivot's own velocity into the bob's", () => {
    const previous: Vec3 = [0, 10, 0];
    const moved: Vec3 = [DT, 10, 0];
    const at = pendulumStep(
      { pos: [0, 8, 0], vel: [0, 0, 0] },
      moved,
      previous,
      2,
    );
    // The pivot moved one unit per second, and the bob's velocity is recomposed
    // from that plus what is left of its own after the constraint.
    expect(at.vel[0]).toBeGreaterThan(0);
  });

  it("damps the swing rather than growing it", () => {
    let bob = { pos: [1.6, 8.8, 0] as Vec3, vel: [0, 0, 0] as Vec3 };
    let first = 0;
    for (let i = 0; i < 60; i++) {
      bob = pendulumStep(bob, pivot, pivot, 2);
      first = Math.max(first, length(bob.vel));
    }
    let later = 0;
    for (let i = 0; i < 60 * 60; i++) {
      bob = pendulumStep(bob, pivot, pivot, 2);
      later = Math.max(later, length(bob.vel));
    }
    expect(later).toBeLessThan(first);
  });
});

describe("the bob's acceleration and the cable's tension", () => {
  it("is zero on a run's first tick, whatever velocity the steps left", () => {
    expect(bobAcceleration([3, 4, 5], [0, 0, 0], true)).toEqual([0, 0, 0]);
  });

  it("is the change in velocity over the tick otherwise", () => {
    const a = bobAcceleration([0, DT, 0], [0, 0, 0], false);
    expect(a[1]).toBeCloseTo(1, 9);
  });

  it("hangs the bob's weight, straight down, at rest", () => {
    const t = cableTension([0, 0, 0], bobMass(40));
    expect(t[0]).toBe(0);
    expect(t[1]).toBe((HOOK_MASS + 40) * GRAVITY);
    expect(length(t)).toBe(450);
  });

  it("counts the hook alone with nothing attached", () => {
    expect(bobMass(null)).toBe(HOOK_MASS);
  });

  it("snaps past HOIST_CABLE_CAP and not at it", () => {
    expect(cableSnaps(HOIST_CABLE_CAP)).toBe(false);
    expect(cableSnaps(HOIST_CABLE_CAP + 1e-9)).toBe(true);
  });
});

describe("attaching", () => {
  const load = (phase: RunLoad["phase"], pos: Vec3): RunLoad => ({
    phase,
    pos,
    yaw: 0,
  });

  it("takes the nearest waiting load within ATTACH_RADIUS", () => {
    const loads = [load("waiting", [0, 0, 5]), load("waiting", [0, 0, 0.5])];
    expect(attachCandidate(loads, [0, 0, 0])).toBe(1);
  });

  it("gives a tie to the load the site lists first", () => {
    const loads = [load("waiting", [0.5, 0, 0]), load("waiting", [-0.5, 0, 0])];
    expect(attachCandidate(loads, [0, 0, 0])).toBe(0);
  });

  it("passes over a load that is not waiting", () => {
    const loads = [load("placed", [0, 0, 0]), load("waiting", [0, 0, 0.5])];
    expect(attachCandidate(loads, [0, 0, 0])).toBe(1);
  });

  it("finds no candidate past ATTACH_RADIUS, the radius itself included", () => {
    expect(
      attachCandidate([load("waiting", [ATTACH_RADIUS, 0, 0])], [0, 0, 0]),
    ).toBe(0);
    expect(
      attachCandidate(
        [load("waiting", [ATTACH_RADIUS + 1e-9, 0, 0])],
        [0, 0, 0],
      ),
    ).toBeNull();
    expect(attachCandidate([], [0, 0, 0])).toBeNull();
  });
});

describe("the wrapped yaw difference", () => {
  it("is the shorter way round, never negative and never above 180", () => {
    expect(wrappedYawDifference(2, 0)).toBeCloseTo(2, 12);
    expect(wrappedYawDifference(-2, 0)).toBeCloseTo(2, 12);
    expect(wrappedYawDifference(358, 0)).toBeCloseTo(2, 12);
    expect(wrappedYawDifference(0, 358)).toBeCloseTo(2, 12);
    expect(wrappedYawDifference(-400, 0)).toBeCloseTo(40, 12);
    expect(wrappedYawDifference(180, 0)).toBeCloseTo(180, 12);
    expect(wrappedYawDifference(90, 450)).toBeCloseTo(0, 12);
  });
});

describe("releasing", () => {
  const load: RunLoad = { phase: "attached", pos: [0, 2, 0], yaw: 0 };
  const target = { pos: [0, 2, 0] as Vec3, yaw: 0 };

  it("places the load when all three tests hold, bounds included", () => {
    expect(judgeRelease(load, target, PLACE_VEL_TOL).placed).toBe(true);
    expect(
      judgeRelease({ ...load, pos: [PLACE_POS_TOL, 2, 0] }, target, 0).placed,
    ).toBe(true);
    expect(
      judgeRelease({ ...load, yaw: PLACE_YAW_TOL }, target, 0).placed,
    ).toBe(true);
  });

  it("drops it when any one of them fails", () => {
    expect(
      judgeRelease({ ...load, pos: [PLACE_POS_TOL + 1e-9, 2, 0] }, target, 0)
        .placed,
    ).toBe(false);
    expect(
      judgeRelease({ ...load, yaw: PLACE_YAW_TOL + 1e-9 }, target, 0).placed,
    ).toBe(false);
    expect(judgeRelease(load, target, PLACE_VEL_TOL + 1e-9).placed).toBe(false);
  });

  it("reads a yaw the long way round as the short one", () => {
    const judgement = judgeRelease({ ...load, yaw: 355 }, target, 0);
    expect(judgement.yawError).toBeCloseTo(5, 12);
    expect(judgement.placed).toBe(true);
  });
});
