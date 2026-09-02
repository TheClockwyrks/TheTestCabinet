import { describe, expect, it } from "vitest";
import {
  COUNTERWEIGHT_MASS,
  GRAVITY,
  RING_MASS,
  STRUT_MASS_PER_UNIT,
  TROLLEY_MASS,
} from "../constants";
import {
  appliedForce,
  assembleArmForces,
  assembleTowerForces,
  GRAVITY_VECTOR,
  lumpedMasses,
  nodeAcceleration,
  trolleyAcceleration,
} from "./loads";
import type { RailTrack } from "./structure";
import type { Member, Structure, TrolleyPlacement } from "./types";
import { nodeKey, type Vec3 } from "./vec";

const axis: readonly [number, number] = [0, 0];

describe("the inertial terms", () => {
  it("draws a node in toward the axis under rotation, as the centripetal term", () => {
    const a = nodeAcceleration([3, 5, 0], axis, 2, 0);
    expect(a[0]).toBeCloseTo(-12, 12);
    expect(a[1]).toBeCloseTo(0, 12);
    expect(a[2]).toBeCloseTo(0, 12);
  });

  it("carries a node standing at +x toward +z under a positive alpha", () => {
    const a = nodeAcceleration([3, 5, 0], axis, 0, 2);
    expect(a[0]).toBeCloseTo(0, 12);
    expect(a[1]).toBeCloseTo(0, 12);
    expect(a[2]).toBeCloseTo(6, 12);
  });

  it("adds the trolley's own drive along the track", () => {
    const a = trolleyAcceleration([3, 5, 0], axis, 0, 0, [1, 0, 0], 0, 4);
    expect(a[0]).toBeCloseTo(4, 12);
    expect(a[1]).toBeCloseTo(0, 12);
    expect(a[2]).toBeCloseTo(0, 12);
  });

  it("runs the Coriolis term the same way as the tangential one", () => {
    // Driving outward along +x while the arm turns from +x toward +z.
    const a = trolleyAcceleration([3, 5, 0], axis, 1, 0, [1, 0, 0], 2, 0);
    expect(a[0]).toBeCloseTo(-3, 12);
    expect(a[2]).toBeCloseTo(4, 12);
  });

  it("applies m * g - m * a at the node", () => {
    const f = appliedForce(3, [0, 0, 2]);
    expect(f[0]).toBeCloseTo(0, 12);
    expect(f[1]).toBeCloseTo(-3 * GRAVITY, 12);
    expect(f[2]).toBeCloseTo(-6, 12);
    expect(GRAVITY_VECTOR).toEqual([0, -GRAVITY, 0]);
  });
});

describe("the lumped masses", () => {
  const member: Member = {
    id: 0,
    a: [0, 0, 0],
    b: [0, 4, 0],
    material: "strut",
  };
  const flange = ["0,4,0", "2,4,0"];

  it("puts half of every member at each of its ends", () => {
    const structure: Structure = {
      members: [member],
      ring: null,
      counterweights: [],
    };
    const masses = lumpedMasses(structure, [member], []);
    expect(masses.get("0,0,0")).toBeCloseTo((4 * STRUT_MASS_PER_UNIT) / 2, 12);
    expect(masses.get("0,4,0")).toBeCloseTo((4 * STRUT_MASS_PER_UNIT) / 2, 12);
  });

  it("adds RING_MASS / 8 at each flange node, whether or not a member ends there", () => {
    const structure: Structure = {
      members: [member],
      ring: null,
      counterweights: [],
    };
    const masses = lumpedMasses(structure, [member], flange);
    expect(masses.get("2,4,0")).toBeCloseTo(RING_MASS / 8, 12);
    expect(masses.get("0,4,0")).toBeCloseTo(
      (4 * STRUT_MASS_PER_UNIT) / 2 + RING_MASS / 8,
      12,
    );
  });

  it("applies nothing for a counterweight left on a node nothing holds", () => {
    const structure: Structure = {
      members: [member],
      ring: null,
      counterweights: [
        [0, 0, 0],
        [8, 8, 8],
      ],
    };
    const masses = lumpedMasses(structure, [member], []);
    expect(masses.get("0,0,0")).toBeCloseTo(
      (4 * STRUT_MASS_PER_UNIT) / 2 + COUNTERWEIGHT_MASS,
      12,
    );
    expect(masses.get("8,8,8")).toBeUndefined();
  });
});

describe("the trolley and cable force on the rail nodes", () => {
  const nodeA: Vec3 = [0, 4, 0];
  const nodeB: Vec3 = [4, 4, 0];
  const track = {
    ok: true,
    origin: nodeA,
    far: nodeB,
    direction: [1, 0, 0],
    length: 4,
    spans: [],
    nodes: [],
  } as unknown as RailTrack;
  const index = new Map([
    [nodeKey(nodeA), 0],
    [nodeKey(nodeB), 1],
  ]);
  const positions = new Map<string, Vec3>([
    [nodeKey(nodeA), nodeA],
    [nodeKey(nodeB), nodeB],
  ]);

  const share = (fraction: number): Float64Array => {
    const trolley: TrolleyPlacement = {
      t: fraction * 4,
      nodeA,
      nodeB,
      fraction,
      spanStartById: new Map(),
    };
    return assembleArmForces({
      index,
      positions,
      masses: new Map(),
      axis,
      omega: 0,
      alpha: 0,
      cos: 1,
      sin: 0,
      track,
      trolley,
      trolleyRate: 0,
      trolleyAccel: 0,
      cableForce: [0, -100, 0],
    });
  };

  it("splits the trolley's mass and the cable force linearly along the member", () => {
    const f = share(0.25);
    const total = -(TROLLEY_MASS * GRAVITY) - 100;
    expect(f[1]).toBeCloseTo(total * 0.75, 9);
    expect(f[4]).toBeCloseTo(total * 0.25, 9);
  });

  it("gives it wholly to one node at a shared node", () => {
    const f = share(0);
    const total = -(TROLLEY_MASS * GRAVITY) - 100;
    expect(f[1]).toBeCloseTo(total, 9);
    expect(f[4]).toBe(0);
  });
});

describe("the tower's applied forces", () => {
  it("carries weight alone, plus the negated ring reaction at each bottom flange", () => {
    const bottom: Vec3[] = [
      [0, 2, 0],
      [2, 2, 0],
    ];
    const index = new Map([
      ["0,2,0", 0],
      ["2,2,0", 1],
    ]);
    const masses = new Map([["0,2,0", 3]]);
    const f = assembleTowerForces(index, masses, bottom, [
      [10, 20, 30],
      [0, 0, 0],
    ]);
    expect(f[0]).toBe(-10);
    expect(f[1]).toBeCloseTo(-3 * GRAVITY - 20, 12);
    expect(f[2]).toBe(-30);
    expect(f[4]).toBe(0);
  });
});
