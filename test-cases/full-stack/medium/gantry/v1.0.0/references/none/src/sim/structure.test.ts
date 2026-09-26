import { describe, expect, it } from "vitest";
import { COUNTERWEIGHT_COST, RING_COST } from "../constants";
import { SIM_SITES } from "./site";
import {
  checkCounterweightPlacement,
  checkMemberPlacement,
  checkRingPlacement,
  cost,
  emptyStructure,
  flangeNodes,
  linksArmToTower,
  partition,
  railTrack,
  readiness,
  slewAxis,
  trackLength,
  usedNodes,
} from "./structure";
import type { Material, Member, Structure } from "./types";
import { nodeKey, type Vec3 } from "./vec";

const site = SIM_SITES[0];

function build(
  members: [Vec3, Vec3, Material][],
  corner: Vec3 | null = [0, 2, 0],
  counterweights: Vec3[] = [],
): Structure {
  return {
    members: members.map(
      ([a, b, material], id): Member => ({
        id,
        a,
        b,
        material,
      }),
    ),
    ring: corner === null ? null : { corner },
    counterweights,
  };
}

/** A tower box under the ring, so the arm has somewhere to sit. */
const TOWER: [Vec3, Vec3, Material][] = [
  [[0, 0, 0], [0, 2, 0], "strut"],
  [[2, 0, 0], [2, 2, 0], "strut"],
  [[0, 0, 2], [0, 2, 2], "strut"],
  [[2, 0, 2], [2, 2, 2], "strut"],
];

describe("the ring", () => {
  it("occupies eight nodes, four bottom and four above them", () => {
    const { bottom, top } = flangeNodes({ corner: [0, 2, 0] });
    expect(bottom).toEqual([
      [0, 2, 0],
      [2, 2, 0],
      [0, 2, 2],
      [2, 2, 2],
    ]);
    expect(top).toEqual([
      [0, 4, 0],
      [2, 4, 0],
      [0, 4, 2],
      [2, 4, 2],
    ]);
  });

  it("pairs a corner's two nodes by index, and puts the slew axis at the square's center", () => {
    const { bottom, top } = flangeNodes({ corner: [-4, 6, 8] });
    for (let i = 0; i < 4; i++) {
      expect([top[i][0], top[i][2]]).toEqual([bottom[i][0], bottom[i][2]]);
    }
    expect(slewAxis({ corner: [-4, 6, 8] })).toEqual([-3, 9]);
  });
});

describe("cost", () => {
  it("sums member length times cost per unit, the ring, and each counterweight", () => {
    const structure = build(
      [[[0, 0, 0], [0, 2, 0], "strut"]],
      [0, 2, 0],
      [[0, 2, 0]],
    );
    expect(cost(structure)).toBe(2 * 10 + RING_COST + COUNTERWEIGHT_COST);
  });

  it("charges nothing for a crane with nothing on it", () => {
    expect(cost(emptyStructure())).toBe(0);
  });
});

describe("the arm and tower partition", () => {
  it("puts what reaches the top flange in the arm and what reaches an anchor in the tower", () => {
    const structure = build([...TOWER, [[0, 4, 0], [4, 4, 0], "rail"]]);
    const { armSet, towerSet } = partition(structure, site.anchors);
    expect(armSet.has(nodeKey([4, 4, 0]))).toBe(true);
    expect(towerSet.has(nodeKey([4, 4, 0]))).toBe(false);
    expect(towerSet.has(nodeKey([0, 2, 0]))).toBe(true);
    expect(armSet.has(nodeKey([0, 2, 0]))).toBe(false);
  });

  it("refuses a member that would join the arm to the tower anywhere but through the ring", () => {
    const structure = build([...TOWER, [[0, 4, 0], [4, 4, 0], "rail"]]);
    expect(
      checkMemberPlacement(site, structure, [4, 4, 0], [2, 2, 2], "strut"),
    ).toBe("links-arm-tower");
    // The same two halves left unjoined is allowed.
    expect(
      checkMemberPlacement(site, structure, [4, 4, 0], [4, 4, 2], "strut"),
    ).toBeNull();
  });

  it("finds no arm and no tower on a crane with no ring, so the rule binds nothing", () => {
    const ringless = build([...TOWER], null);
    expect(linksArmToTower(ringless, site.anchors)).toBe(false);
    expect(
      checkMemberPlacement(site, ringless, [0, 2, 0], [0, 4, 0], "strut"),
    ).toBeNull();
  });
});

describe("the rail track", () => {
  const withRails = (rails: [Vec3, Vec3, Material][]): Structure =>
    build([
      ...TOWER,
      [[0, 4, 0], [0, 4, 2], "strut"],
      [[0, 4, 2], [8, 4, 2], "strut"],
      ...rails,
    ]);

  it("takes the end nearer the slew axis as the origin, and measures its length", () => {
    const track = railTrack(
      withRails([[[0, 4, 0], [4, 4, 0], "rail"]]),
      site.anchors,
    );
    expect(track.ok).toBe(true);
    if (!track.ok) return;
    expect(track.origin).toEqual([0, 4, 0]);
    expect(track.far).toEqual([4, 4, 0]);
    expect(track.length).toBe(4);
    expect(track.direction).toEqual([1, 0, 0]);
  });

  it("accepts rails meeting end to end and orders their spans along the track", () => {
    const track = railTrack(
      withRails([
        [[2, 4, 0], [4, 4, 0], "rail"],
        [[0, 4, 0], [2, 4, 0], "rail"],
      ]),
      site.anchors,
    );
    expect(track.ok).toBe(true);
    if (!track.ok) return;
    expect(track.spans.map((s) => [s.s0, s.s1])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(track.spans[0].nodeA).toEqual([0, 4, 0]);
    expect(track.nodes).toEqual([
      [0, 4, 0],
      [2, 4, 0],
      [4, 4, 0],
    ]);
  });

  it("refuses a rail that is not horizontal", () => {
    const structure = withRails([[[0, 4, 0], [0, 6, 0], "rail"]]);
    expect(railTrack(structure, site.anchors)).toEqual({
      ok: false,
      issue: "invalid-rail",
    });
    expect(
      checkMemberPlacement(
        site,
        build([...TOWER]),
        [0, 4, 0],
        [0, 6, 0],
        "rail",
      ),
    ).toBe("rail-not-horizontal");
  });

  it("refuses rails that are not all on one line", () => {
    const track = railTrack(
      withRails([
        [[0, 4, 0], [2, 4, 0], "rail"],
        [[2, 4, 0], [2, 4, 2], "rail"],
      ]),
      site.anchors,
    );
    expect(track.ok).toBe(false);
  });

  it("refuses a gap between rails, and a rail outside the run they cover", () => {
    const gapped = railTrack(
      withRails([
        [[0, 4, 0], [2, 4, 0], "rail"],
        [[4, 4, 0], [6, 4, 0], "rail"],
      ]),
      site.anchors,
    );
    expect(gapped.ok).toBe(false);
  });

  it("refuses a set that satisfies the path-graph consequence without covering the run once", () => {
    // Two rails end to end at a shared node, doubling back on themselves: three
    // nodes, two edges, two ends, connected — and yet the second nests inside
    // the stretch the first covers.
    const doubled = railTrack(
      withRails([
        [[0, 4, 0], [4, 4, 0], "rail"],
        [[4, 4, 0], [2, 4, 0], "rail"],
      ]),
      site.anchors,
    );
    expect(doubled).toEqual({ ok: false, issue: "invalid-rail" });
  });

  it("refuses a branch, which gives a node three rails", () => {
    const branched = railTrack(
      withRails([
        [[0, 4, 0], [2, 4, 0], "rail"],
        [[2, 4, 0], [4, 4, 0], "rail"],
        [[2, 4, 0], [2, 4, 2], "rail"],
      ]),
      site.anchors,
    );
    expect(branched.ok).toBe(false);
  });

  it("refuses ends at the same distance from the slew axis", () => {
    // (0,4,0) and (2,4,0) both stand one unit each way from the axis at (1,1).
    const symmetric = railTrack(
      withRails([[[0, 4, 0], [2, 4, 0], "rail"]]),
      site.anchors,
    );
    expect(symmetric).toEqual({ ok: false, issue: "invalid-rail" });
  });

  it("refuses a rail that is not in the arm", () => {
    const towerRail = build([...TOWER, [[0, 0, 0], [4, 0, 0], "rail"]]);
    expect(railTrack(towerRail, site.anchors)).toEqual({
      ok: false,
      issue: "invalid-rail",
    });
  });

  it("leaves the track unjudged on a crane with no ring", () => {
    const ringless = build([...TOWER, [[0, 4, 0], [2, 4, 0], "rail"]], null);
    expect(railTrack(ringless, site.anchors)).toEqual({
      ok: false,
      issue: "no-ring",
    });
    // `invalid-rail` is not among them: the rails go unjudged, and the rail
    // itself reaches neither half of a crane that has no halves.
    expect(readiness(ringless, site.anchors)).toEqual([
      "no-ring",
      "disconnected-members",
    ]);
  });

  it("reports no track length when the rails form none", () => {
    expect(trackLength(build([...TOWER]), site.anchors)).toBe(0);
  });
});

describe("readiness", () => {
  const armed: [Vec3, Vec3, Material][] = [
    [[0, 4, 0], [0, 4, 2], "strut"],
    [[0, 4, 0], [4, 4, 0], "rail"],
  ];

  it("is empty on a ready crane", () => {
    expect(readiness(build([...TOWER, ...armed]), site.anchors)).toEqual([]);
  });

  it("reports the issues in the order specs/structure.md lists them", () => {
    const ringless = build([...TOWER], null);
    expect(readiness(ringless, site.anchors)).toEqual(["no-ring", "no-rail"]);
  });

  it("raises no-rail alone on a crane that has a ring and no rails", () => {
    expect(readiness(build([...TOWER]), site.anchors)).toEqual(["no-rail"]);
  });

  it("raises disconnected-members for a member joined to neither half", () => {
    const floating = build([
      ...TOWER,
      ...armed,
      [[8, 8, 8], [8, 8, 6], "strut"],
    ]);
    expect(readiness(floating, site.anchors)).toEqual(["disconnected-members"]);
  });
});

describe("the editor's rules", () => {
  const structure = build([...TOWER]);

  it("refuses a member outside the envelope or joining a node to itself", () => {
    expect(
      checkMemberPlacement(site, structure, [0, 0, 0], [0, 0, -10], "strut"),
    ).toBe("outside-envelope");
    expect(
      checkMemberPlacement(site, structure, [0, 0, 0], [0, 0, 0], "strut"),
    ).toBe("same-node");
  });

  it("refuses a node off the lattice", () => {
    expect(
      checkMemberPlacement(site, structure, [1, 0, 0], [1, 2, 0], "strut"),
    ).toBe("off-lattice");
  });

  it("refuses a member longer than its material's maximum", () => {
    expect(
      checkMemberPlacement(site, structure, [0, 0, 0], [8, 0, 0], "strut"),
    ).toBe("too-long");
    expect(
      checkMemberPlacement(site, structure, [0, 0, 0], [8, 0, 0], "cable"),
    ).toBeNull();
  });

  it("refuses a member already joining the same two nodes, in either direction", () => {
    expect(
      checkMemberPlacement(site, structure, [0, 2, 0], [0, 0, 0], "cable"),
    ).toBe("duplicate");
  });

  it("refuses a member reaching inside an obstacle and allows one lying flush along it", () => {
    const walled = SIM_SITES[2];
    // The wall stands from x 5 to x 6, z -6 to 6, y 0 to 8.
    expect(
      checkMemberPlacement(
        walled,
        emptyStructure(),
        [4, 2, 0],
        [6, 2, 0],
        "strut",
      ),
    ).toBe("inside-obstacle");
    expect(
      checkMemberPlacement(
        walled,
        emptyStructure(),
        [6, 2, 0],
        [8, 2, 0],
        "strut",
      ),
    ).toBeNull();
  });

  it("refuses an edit that would take the cost past the budget", () => {
    const poor = { ...site, budget: 10 };
    expect(
      checkMemberPlacement(
        poor,
        emptyStructure(),
        [0, 0, 0],
        [0, 2, 0],
        "strut",
      ),
    ).toBe("over-budget");
  });
});

describe("ring and counterweight placement", () => {
  it("refuses a second ring, a corner on the ground, and a flange outside the envelope", () => {
    expect(checkRingPlacement(site, build([], [0, 2, 0]), [4, 4, 4])).toBe(
      "ring-exists",
    );
    expect(checkRingPlacement(site, emptyStructure(), [0, 0, 0])).toBe(
      "ring-on-ground",
    );
    expect(checkRingPlacement(site, emptyStructure(), [12, 4, 0])).toBe(
      "outside-envelope",
    );
  });

  it("accepts a ring whose eight nodes all lie inside the envelope", () => {
    expect(checkRingPlacement(site, emptyStructure(), [0, 2, 0])).toBeNull();
  });

  it("counts a flange node as used whether or not a member ends there", () => {
    const structure = build([...TOWER]);
    const used = usedNodes(structure);
    expect(used.has(nodeKey([0, 4, 0]))).toBe(true);
    expect(checkCounterweightPlacement(site, structure, [0, 4, 0])).toBeNull();
  });

  it("refuses a counterweight on an unused node and a second on one node", () => {
    const structure = build([...TOWER], [0, 2, 0], [[0, 2, 0]]);
    expect(checkCounterweightPlacement(site, structure, [8, 8, 8])).toBe(
      "node-unused",
    );
    expect(checkCounterweightPlacement(site, structure, [0, 2, 0])).toBe(
      "counterweight-exists",
    );
  });
});
