// check/check-trolley-at-the-track-origin — the check lumps the whole trolley at
// the track's origin and none of it at the far end.
//
// specs/structure.md § The static check: the solves run at "`trolley` `0`", and
// § The trolley and the rail says what `0` is: "The end nearer the slew axis is
// the track's origin. The trolley's position is its distance along the track from
// that origin". specs/statics.md § The load model then says where the mass goes:
// "The trolley's `TROLLEY_MASS` sits at the trolley point and is shared between
// the two nodes of the rail member the trolley is on, linearly by its position
// along that member", and the cable force "is applied at the trolley point and
// shared between the same two rail nodes the trolley's mass is". At position `0`
// the trolley stands on the origin node itself, so the whole of `TROLLEY_MASS`
// (`15`) and the whole of the bare hook's cable force are that node's, and the
// far end carries neither.
//
// THE CRANE IS BUILT SO THAT ONE MEMBER READS ONE NODE'S WEIGHT. Both ends of the
// track are ordinary arm nodes rather than flange nodes — a flange node is a
// support of the arm solve (specs/statics.md) and carries a reaction instead of
// an equilibrium — and each has exactly ONE member with a vertical component: a
// vertical hanger at the origin, a sloped one at the far end, every other member
// there horizontal. A solved truss is in equilibrium at every free node, so the
// vertical component of that one member's force is exactly the weight lumped at
// its node, and the two figures below are the load model, written out.
//
// Both figures are computed from the design and the material table rather than
// written as constants, so what the assertion rests on is legible: each node's
// member halves, plus `TROLLEY_MASS` and the hook's cable force at the origin
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, fail } from "../assert";
import {
  GRAVITY,
  HOOK_MASS,
  RAIL_MASS_PER_UNIT,
  STRUT_MASS_PER_UNIT,
  TROLLEY_MASS,
} from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type LatticeNode,
} from "../harness";

/** The track's origin: the track end nearer the slew axis at `(1, ., 1)`. */
const ORIGIN: LatticeNode = [4, 4, 0];
/** The track's far end, further from that axis. */
const FAR: LatticeNode = [6, 4, 0];
/** The node both hangers rise to. */
const HEAD: LatticeNode = [4, 8, 0];

/**
 * A crane whose track hangs below the arm on two readable hangers.
 *
 * The tower, the ring and the mast are the minimal crane's. Above the track sits
 * a head node `(4, 8, 0)`, tied to the mast and to two top-flange nodes. The
 * origin `(4, 4, 0)` hangs from it on a vertical strut and is held sideways by
 * two horizontal struts to the flange and by the rail; the far end `(6, 4, 0)`
 * hangs from the same head on a sloped strut and is held by one horizontal strut
 * and the rail. So each track node carries exactly one member with a vertical
 * component, and its force is that node's weight.
 *
 * The track is one rail: horizontal, trivially collinear and unbroken, in the
 * arm, and with its ends at distinct horizontal distances from the slew axis —
 * `sqrt(10)` and `sqrt(26)` — so `(4, 4, 0)` is the origin.
 */
const HUNG_TRACK: CraneDesign = {
  site: 0,
  name: "Hung track",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    // The tower: the minimal crane's, anchors to bottom flange.
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 2], "strut"],
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 0], [0, 2, 2], "strut"],
    [[2, 0, 0], [2, 2, 2], "strut"],
    [[0, 0, 2], [2, 2, 2], "strut"],
    // The mast, tied to all four top-flange nodes.
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[2, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[2, 4, 2], [0, 8, 0], "strut"],
    // The head the two hangers rise to.
    [[0, 8, 0], [4, 8, 0], "strut"],
    [[2, 4, 0], [4, 8, 0], "strut"],
    [[2, 4, 2], [4, 8, 0], "strut"],
    // The track, and the origin's hanger and horizontal ties.
    [[4, 4, 0], [6, 4, 0], "rail"],
    [[4, 4, 0], [4, 8, 0], "strut"],
    [[4, 4, 0], [0, 4, 2], "strut"],
    [[4, 4, 0], [2, 4, 2], "strut"],
    // The far end's hanger and its one horizontal tie.
    [[6, 4, 0], [4, 8, 0], "strut"],
    [[6, 4, 0], [2, 4, 2], "strut"],
  ],
  tape: [],
};

/** Mass per unit length, from the material table of specs/structure.md. */
const MASS_PER_UNIT = {
  strut: STRUT_MASS_PER_UNIT,
  cable: 0,
  rail: RAIL_MASS_PER_UNIT,
} as const;

/** Force units. An equilibrium residual is orders of magnitude under this. */
const FORCE_TOL = 1e-4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lumps the whole trolley at the origin end of the track and none at the far end", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, HUNG_TRACK);

  const result = await h.check();
  await h.advance(1);
  await h.capture(
    "trolley-at-the-origin",
    "the hung track, with the trolley standing at its origin",
  );

  assertEqual(
    result.stable,
    true,
    "the hung-track crane standing, so the check reports its member forces " +
      "(specs/structure.md)",
  );

  // The origin's hanger is vertical, so it carries the node's whole weight:
  // the halves of the four members ending there, plus TROLLEY_MASS, plus the
  // bare hook's cable force, all times GRAVITY.
  const originHanger = memberId(ORIGIN, HEAD);
  const originWeight =
    (halfMassAt(ORIGIN) + TROLLEY_MASS) * GRAVITY + HOOK_MASS * GRAVITY;
  assertNear(
    forceOf(result.members, originHanger),
    originWeight,
    FORCE_TOL,
    `the vertical hanger at the track origin (${ORIGIN.join(", ")}), which ` +
      `carries that node's member halves plus TROLLEY_MASS (${TROLLEY_MASS}) ` +
      `and the bare hook (specs/statics.md § The load model)`,
  );

  // The far end's hanger is sloped, so the weight is its force's vertical
  // component: the halves of its three members and nothing else.
  const farHanger = memberId(FAR, HEAD);
  const farWeight = halfMassAt(FAR) * GRAVITY;
  assertNear(
    forceOf(result.members, farHanger) * verticalOf(FAR, HEAD),
    farWeight,
    FORCE_TOL,
    `the vertical pull of the hanger at the track's far end ` +
      `(${FAR.join(", ")}), which carries that node's member halves and no ` +
      "share of the trolley, standing as it does at the far end of the track",
  );
});

/** The straight-line length of a design member. */
function lengthOf(a: LatticeNode, b: LatticeNode): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Whether two lattice nodes are the same node. */
function same(a: LatticeNode, b: LatticeNode): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * The mass the design's members lump at a node: "half of every intact member
 * ending at it, each half being the member's length times its material's mass
 * per unit" (specs/statics.md § The load model).
 */
function halfMassAt(node: LatticeNode): number {
  let mass = 0;
  for (const [a, b, material] of HUNG_TRACK.members) {
    if (!same(a, node) && !same(b, node)) continue;
    mass += (lengthOf(a, b) * MASS_PER_UNIT[material]) / 2;
  }
  return mass;
}

/** The `y` component of the unit vector from `node` toward `toward`. */
function verticalOf(node: LatticeNode, toward: LatticeNode): number {
  return (toward[1] - node[1]) / lengthOf(node, toward);
}

/** The id a member takes, which is its index in the order the crane is posed. */
function memberId(a: LatticeNode, b: LatticeNode): number {
  const index = HUNG_TRACK.members.findIndex(
    ([one, two]: DesignMember) =>
      (same(one, a) && same(two, b)) || (same(one, b) && same(two, a)),
  );
  if (index < 0) {
    throw new Error(
      `gantry: the hung-track design carries no member between ` +
        `(${a.join(", ")}) and (${b.join(", ")})`,
    );
  }
  return index;
}

/** The force the check reports for a member, or a failure naming its absence. */
function forceOf(
  members: readonly { id: number; force: number }[],
  id: number,
): number {
  const member = members.find((one) => one.id === id);
  if (member === undefined) {
    fail(
      `the check to report member ${id}, which the crane holds ` +
        "(specs/structure.md)",
      `members ${members.map((one) => one.id).join(", ")}`,
    );
  }
  return member.force;
}
