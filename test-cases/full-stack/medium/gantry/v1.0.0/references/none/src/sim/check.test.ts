import { describe, expect, it } from "vitest";
import { RING_COST } from "../constants";
import { startIssues, staticCheck } from "./check";
import { SIM_SITES } from "./site";
import { cost, emptyStructure } from "./structure";
import type { Material, Structure, Tape } from "./types";
import type { Vec3 } from "./vec";

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

/** Ready, and a mechanism: the jib tip is held by one member along one line. */
function mechanism(): Structure {
  const m: [Vec3, Vec3, Material][] = [
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    [[0, 4, 0], [4, 4, 0], "rail"],
  ];
  return {
    members: m.map(([a, b, material], id) => ({ id, a, b, material })),
    ring: { corner: [0, 2, 0] },
    counterweights: [],
  };
}

const ACTION: Tape = [{ kind: "action", action: "attach" }];

describe("the issues a start would be refused with", () => {
  it("lists the readiness issues, and empty-program last", () => {
    expect(startIssues(site, emptyStructure(), [])).toEqual([
      "no-ring",
      "no-rail",
      "empty-program",
    ]);
  });

  it("is empty on a ready crane with a tape", () => {
    expect(startIssues(site, miniCrane(), ACTION)).toEqual([]);
  });
});

describe("the static check", () => {
  it("reports no member at all when a readiness issue refuses the solve", () => {
    const result = staticCheck(site, emptyStructure(), []);
    expect(result.stable).toBe(false);
    expect(result.members).toEqual([]);
    expect(result.issues).toEqual(["no-ring", "no-rail", "empty-program"]);
    expect(result.cost).toBe(0);
    expect(result.budget).toBe(site.budget);
  });

  it("reports the cost and the budget whatever the verdict", () => {
    const structure = miniCrane();
    const result = staticCheck(site, structure, ACTION);
    expect(result.cost).toBeCloseTo(cost(structure), 9);
    expect(result.cost).toBeGreaterThan(RING_COST);
    expect(result.budget).toBe(site.budget);
  });

  it("solves a ready structure whether or not it has a tape", () => {
    const structure = miniCrane();
    const withoutTape = staticCheck(site, structure, []);
    const withTape = staticCheck(site, structure, ACTION);
    expect(withoutTape.issues).toEqual(["empty-program"]);
    expect(withTape.issues).toEqual([]);
    expect(withoutTape.stable).toBe(true);
    expect(withTape.stable).toBe(true);
    expect(withoutTape.members).toEqual(withTape.members);
  });

  it("reports every member's force and utilization, in member-id order", () => {
    const structure = miniCrane();
    const result = staticCheck(site, structure, ACTION);
    expect(result.members).toHaveLength(structure.members.length);
    expect(result.members.map((m) => m.id)).toEqual(
      structure.members.map((m) => m.id),
    );
    for (const m of result.members) {
      expect(Number.isFinite(m.force)).toBe(true);
      expect(m.utilization).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not stand when a solve goes singular, and reports no member", () => {
    const result = staticCheck(site, mechanism(), ACTION);
    expect(result.issues).toEqual([]);
    expect(result.stable).toBe(false);
    expect(result.members).toEqual([]);
  });
});
