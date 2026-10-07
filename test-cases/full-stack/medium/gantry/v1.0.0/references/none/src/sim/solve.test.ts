import { describe, expect, it } from "vitest";
import { GRAVITY, HOOK_MASS, TROLLEY_MASS } from "../constants";
import { lumpedMasses } from "./loads";
import { utilization } from "./materials";
import { SIM_SITES } from "./site";
import {
  canonicalNodeOrder,
  computeGeometry,
  railBreakTakesTrack,
  solvePair,
  solveStage,
} from "./solve";
import { flangeNodes, memberLength, railTrack, slewAxis } from "./structure";
import type {
  Material,
  Member,
  Motion,
  Structure,
  TrolleyPlacement,
} from "./types";
import { length, nodeKey, type Vec3 } from "./vec";

const site = SIM_SITES[0];

/**
 * A small crane that stands: a braced 2x2 tower box under a ring at
 * `(0, 2, 0)`, a mast over the top flange, a jib whose seaward chord is the
 * rail, four stays, and a short counter-jib. Its members are in placement
 * order, so a member's index is its id.
 */
function miniCrane(): Structure {
  const m: [Vec3, Vec3, Material][] = [
    // the tower: legs, the top square, a face diagonal each way, a plan brace
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 2], "strut"],
    [[2, 0, 2], [0, 2, 2], "strut"],
    [[0, 0, 2], [0, 2, 0], "strut"],
    [[2, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 2], [2, 2, 0], "strut"],
    [[0, 0, 2], [2, 2, 2], "strut"],
    [[0, 0, 0], [0, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 2], "strut"],
    // the mast, over the top flange
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 2], "strut"],
    [[0, 8, 0], [0, 8, 2], "strut"],
    [[0, 4, 0], [0, 8, 2], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[0, 8, 0], [2, 4, 0], "strut"],
    [[0, 8, 0], [2, 4, 2], "strut"],
    [[0, 8, 2], [2, 4, 0], "strut"],
    [[0, 8, 2], [2, 4, 2], "strut"],
    // the jib, carrying the rail out to x = 4
    [[0, 4, 0], [4, 4, 0], "rail"],
    [[0, 4, 2], [4, 4, 2], "strut"],
    [[0, 4, 0], [0, 4, 2], "strut"],
    [[4, 4, 0], [4, 4, 2], "strut"],
    [[0, 4, 0], [4, 4, 2], "strut"],
    // the stays
    [[0, 8, 0], [4, 4, 0], "cable"],
    [[0, 8, 2], [4, 4, 2], "cable"],
    [[0, 8, 0], [4, 4, 2], "cable"],
    [[0, 8, 2], [4, 4, 0], "cable"],
    // the counter-jib and its backstays
    [[0, 4, 0], [-2, 4, 0], "strut"],
    [[0, 4, 2], [-2, 4, 2], "strut"],
    [[-2, 4, 0], [-2, 4, 2], "strut"],
    [[-2, 4, 0], [0, 4, 2], "strut"],
    [[0, 8, 0], [-2, 4, 0], "strut"],
    [[0, 8, 2], [-2, 4, 2], "strut"],
  ];
  return {
    members: m.map(([a, b, material], id) => ({ id, a, b, material })),
    ring: { corner: [0, 2, 0] },
    counterweights: [],
  };
}

const AT_REST: Motion = {
  slew: { value: 0, rate: 0, accel: 0 },
  trolley: { value: 0, rate: 0, accel: 0 },
};

function trolleyAt(structure: Structure, t: number): TrolleyPlacement {
  const track = railTrack(structure, site.anchors);
  if (!track.ok) throw new Error("the fixture has no track");
  const span =
    track.spans.find((s) => t >= s.s0 && t <= s.s1) ?? track.spans[0];
  return {
    t,
    nodeA: span.nodeA,
    nodeB: span.nodeB,
    fraction: (t - span.s0) / (span.s1 - span.s0),
    spanStartById: new Map(track.spans.map((s) => [s.member.id, s.s0])),
  };
}

const HOOK_AT_REST: Vec3 = [0, -HOOK_MASS * GRAVITY, 0];

describe("the canonical node order", () => {
  it("ascends by x, then y, then z", () => {
    expect(
      canonicalNodeOrder(["2,0,0", "0,4,2", "0,0,2", "0,4,0", "-2,0,0"]),
    ).toEqual(["-2,0,0", "0,0,2", "0,4,0", "0,4,2", "2,0,0"]);
  });
});

describe("the prescribed geometry", () => {
  const structure = miniCrane();
  const axis = slewAxis({ corner: [0, 2, 0] });

  it("turns arm nodes with the slew angle and leaves tower nodes alone", () => {
    const geometry = computeGeometry(
      structure,
      structure.members,
      site.anchors,
      axis,
      90,
    );
    const tip = geometry.positions.get(nodeKey([4, 4, 0])) as Vec3;
    expect(tip[0]).toBeCloseTo(1 + 1, 9);
    expect(tip[2]).toBeCloseTo(1 + 3, 9);
    expect(geometry.positions.get(nodeKey([0, 2, 0]))).toEqual([0, 2, 0]);
    expect(geometry.positions.get(nodeKey([2, 0, 2]))).toEqual([2, 0, 2]);
  });

  it("carries every node either solve reads, the flange nodes and the anchors included", () => {
    const geometry = computeGeometry(
      structure,
      structure.members,
      site.anchors,
      axis,
      0,
    );
    for (const node of [
      ...flangeNodes(structure.ring).bottom,
      ...site.anchors,
    ]) {
      expect(geometry.positions.has(nodeKey(node))).toBe(true);
    }
  });
});

describe("the pair of solves", () => {
  const structure = miniCrane();
  const axis = slewAxis({ corner: [0, 2, 0] });

  it("stands at rest, with one reaction per ring corner", () => {
    const result = solvePair(
      structure,
      site.anchors,
      axis,
      AT_REST,
      structure.members,
      HOOK_AT_REST,
      trolleyAt(structure, 0),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ringReactions).toHaveLength(4);
    expect(result.ringOver).toBe(false);
  });

  it("balances the whole crane at the anchors", () => {
    const trolley = trolleyAt(structure, 2);
    const result = solvePair(
      structure,
      site.anchors,
      axis,
      AT_REST,
      structure.members,
      HOOK_AT_REST,
      trolley,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const flange = [
      ...flangeNodes(structure.ring).bottom,
      ...flangeNodes(structure.ring).top,
    ].map(nodeKey);
    let mass = 0;
    for (const m of lumpedMasses(
      structure,
      structure.members,
      flange,
    ).values()) {
      mass += m;
    }
    let total = 0;
    for (const r of result.anchorReactions) total += r[1];
    expect(total).toBeCloseTo((mass + TROLLEY_MASS + HOOK_MASS) * GRAVITY, 6);
  });

  it("leaves a member joined to neither half out of both solves", () => {
    const floating: Member = {
      id: 900,
      a: [8, 8, 8],
      b: [8, 8, 6],
      material: "strut",
    };
    const withFloating: Structure = {
      ...structure,
      members: [...structure.members, floating],
    };
    const result = solvePair(
      withFloating,
      site.anchors,
      axis,
      AT_REST,
      withFloating.members,
      HOOK_AT_REST,
      trolleyAt(structure, 0),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forces.has(900)).toBe(false);
    // Which is the zero force and zero utilization it reports.
    expect(utilization("strut", 2, result.forces.get(900) ?? 0)).toBe(0);
  });
});

describe("slack cables", () => {
  const structure = miniCrane();
  const axis = slewAxis({ corner: [0, 2, 0] });
  const cables = structure.members.filter((m) => m.material === "cable");

  const forcesUnder = (cableForce: Vec3): Map<number, number> => {
    const result = solvePair(
      structure,
      site.anchors,
      axis,
      AT_REST,
      structure.members,
      cableForce,
      trolleyAt(structure, 4),
    );
    if (!result.ok) throw new Error(`solve failed: ${result.cause}`);
    return new Map(result.forces);
  };

  it("drops a cable whose force comes back negative and gives it exactly zero", () => {
    const light = forcesUnder([0, -1000, 0]);
    const heavy = forcesUnder([0, -2000, 0]);
    const wentSlack = cables.filter(
      (m) => (light.get(m.id) as number) > 0 && heavy.get(m.id) === 0,
    );
    expect(wentSlack.length).toBeGreaterThan(0);
    for (const m of cables) expect(heavy.get(m.id)).toBeGreaterThanOrEqual(0);
  });

  it("makes a cable a candidate again at the next solve: slack per solve, never permanently", () => {
    const light = forcesUnder([0, -1000, 0]);
    const heavy = forcesUnder([0, -2000, 0]);
    const again = forcesUnder([0, -1000, 0]);
    const wentSlack = cables.filter(
      (m) => (light.get(m.id) as number) > 0 && heavy.get(m.id) === 0,
    );
    for (const m of wentSlack) {
      expect(again.get(m.id)).toBe(light.get(m.id));
      expect(again.get(m.id)).toBeGreaterThan(0);
    }
  });
});

describe("breakage", () => {
  const structure = miniCrane();
  const axis = slewAxis({ corner: [0, 2, 0] });
  const heavy: Vec3 = [0, -4000, 0];

  it("removes every over-utilized member at once, in ascending member-id order", () => {
    const trolley = trolleyAt(structure, 4);
    const first = solvePair(
      structure,
      site.anchors,
      axis,
      AT_REST,
      structure.members,
      heavy,
      trolley,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const over = structure.members
      .filter((m) => {
        const f = first.forces.get(m.id);
        return (
          f !== undefined && utilization(m.material, memberLength(m), f) > 1
        );
      })
      .map((m) => m.id);
    expect(over.length).toBeGreaterThan(1);
    const stage = solveStage(
      structure,
      site.anchors,
      axis,
      AT_REST,
      structure.members,
      heavy,
      trolley,
    );
    expect(stage.brokenAdded.slice(0, over.length)).toEqual(
      [...over].sort((a, b) => a - b),
    );
  });

  it("ends the run as collapse when a rail it broke was under the trolley, recording everything that broke", () => {
    const stage = solveStage(
      structure,
      site.anchors,
      axis,
      AT_REST,
      structure.members,
      heavy,
      trolleyAt(structure, 4),
    );
    expect(stage.ok).toBe(false);
    if (stage.ok) return;
    expect(stage.cause).toBe("collapse");
    const rail = structure.members.find((m) => m.material === "rail") as Member;
    expect(stage.brokenAdded).toContain(rail.id);
    expect(stage.intact).toHaveLength(
      structure.members.length - stage.brokenAdded.length,
    );
  });

  it("breaks nothing on a crane that carries its load", () => {
    const stage = solveStage(
      structure,
      site.anchors,
      axis,
      AT_REST,
      structure.members,
      HOOK_AT_REST,
      trolleyAt(structure, 4),
    );
    expect(stage.ok).toBe(true);
    expect(stage.brokenAdded).toEqual([]);
  });
});

describe("a rail breaking under the trolley", () => {
  const structure = miniCrane();
  const rail = structure.members.find((m) => m.material === "rail") as Member;
  const other = structure.members[0];

  const at = (t: number): TrolleyPlacement => ({
    t,
    nodeA: [0, 4, 0],
    nodeB: [4, 4, 0],
    fraction: 0,
    spanStartById: new Map([
      [rail.id, 2],
      [other.id, 0],
    ]),
  });

  it("takes the track when the trolley is on the broken member", () => {
    expect(railBreakTakesTrack(at(2), [rail])).toBe(true);
  });

  it("takes the track when the trolley is beyond it", () => {
    expect(railBreakTakesTrack(at(3), [rail])).toBe(true);
  });

  it("merely shortens the track when the break is outboard of the trolley", () => {
    expect(railBreakTakesTrack(at(1.9), [rail])).toBe(false);
  });

  it("reads rails alone, and nothing at all with no trolley", () => {
    expect(railBreakTakesTrack(at(3), [other])).toBe(false);
    expect(railBreakTakesTrack(null, [rail])).toBe(false);
  });
});

describe("member lengths", () => {
  it("measures the distance between a member's ends", () => {
    expect(
      memberLength({ id: 0, a: [0, 0, 0], b: [0, 4, 3], material: "strut" }),
    ).toBe(5);
    expect(length([0, 4, 3])).toBe(5);
  });
});
