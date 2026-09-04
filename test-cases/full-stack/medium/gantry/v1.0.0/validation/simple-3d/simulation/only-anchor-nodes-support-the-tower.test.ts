// simulation/only-anchor-nodes-support-the-tower — the tower solve is supported
// on the site's anchors, and the ground is not a support.
//
// specs/statics.md, The two solves: "The tower solve. Nodes: the tower's, at
// their lattice positions. Supports: the anchor nodes." `specs/world.md` says the
// same from the site's side: an anchor is "the one kind of support the structure
// has", and members "attach to anchor nodes like any other node".
//
// The one edit is the foot of a leg. The rig's leg from the anchor `(2, 0, 0)` is
// removed and the same strut is placed from `(4, 0, 0)` instead — a ground
// lattice node inside site 1's envelope that the site does not list as an anchor.
// Nothing else moves, so the two readings differ in the support set and in
// nothing else. With the foot on the ground node, that node is an ordinary node
// of the tower solve carrying one member: it has stiffness along that member and
// none across it, which leaves the supported system singular.
//
// Readiness is untouched either way — the strut still runs to a bottom-flange
// node, so it belongs to the tower and `disconnected-members` is not raised — and
// the tape is posed so `empty-program` is not among the issues. A build that
// held every ground node immovable would stand this crane up, which is the
// difference the reading is looking for.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  type CraneDesign,
  type Harness,
} from "../harness";

/**
 * The rig every reading below is taken on, and why it is shaped this way.
 *
 * It is a plain crane, built under the rules of `specs/structure.md` alone, but
 * three of its nodes are arranged so that one member's force is fixed by a single
 * equation rather than by the whole solve, which is what lets a reading be
 * compared against a figure the specification states:
 *
 *   - The tower is the braced box from the four anchors to the ring's bottom
 *     flange at `(0, 4, 0)`. The bottom-flange corner `(0, 4, 0)` is reached by
 *     its vertical leg (id 0) and by horizontals alone, so vertical equilibrium
 *     there reads `N = F.y` on that leg and on nothing else.
 *   - The arm is a mast head at `(2, 10, 0)` tied to all four top-flange nodes, a
 *     spur node at `(4, 6, 2)`, and the track `(4, 6, 0)-(6, 6, 0)-(8, 6, 0)`.
 *   - Each of the three track nodes is hung from the mast by ONE cable — the only
 *     member at that node with a `y` component — and braced sideways by
 *     horizontals, one of which is the only member there with a `z` component. So
 *     the cable carries the whole vertical load lumped at its node, `V / |n.y|`,
 *     and the sideways brace the whole `z` load.
 *   - The track origin is `(4, 6, 0)`, the end nearer the slew axis, and it is an
 *     ordinary arm node carrying exactly one rail — so the rail's force follows
 *     from that node's `x` equilibrium once the other two are known.
 *
 * Every node lies inside the envelope of the site each reading opens, the crane
 * costs well under that site's budget, and `check` reports no issue and a
 * structure that stands.
 */
const RIG: CraneDesign = {
  site: 1,
  name: "Reference rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: [
    // The tower: four legs, the bottom-flange square and one diagonal across it,
    // and one diagonal on each of the box's four sides.
    [[0, 0, 0], [0, 4, 0], "strut"],
    [[2, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 2], [0, 4, 2], "strut"],
    [[2, 0, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 0], "strut"],
    [[0, 4, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [0, 4, 2], "strut"],
    [[2, 4, 0], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 2], "strut"],
    [[0, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 0], [0, 4, 2], "strut"],
    [[2, 0, 0], [2, 4, 2], "strut"],
    [[0, 0, 2], [2, 4, 2], "strut"],
    // The mast head, tied to all four top-flange nodes.
    [[2, 6, 0], [2, 10, 0], "strut"],
    [[0, 6, 0], [2, 10, 0], "strut"],
    [[2, 6, 2], [2, 10, 0], "strut"],
    [[0, 6, 2], [2, 10, 0], "strut"],
    // The spur node the outboard sideways braces run back to.
    [[2, 6, 2], [4, 6, 2], "strut"],
    [[2, 6, 0], [4, 6, 2], "strut"],
    [[2, 10, 0], [4, 6, 2], "strut"],
    // The track, and the cable and the sideways brace at each of its nodes.
    [[4, 6, 0], [6, 6, 0], "rail"],
    [[6, 6, 0], [8, 6, 0], "rail"],
    [[2, 10, 0], [4, 6, 0], "cable"],
    [[2, 6, 2], [4, 6, 0], "strut"],
    [[2, 10, 0], [6, 6, 0], "cable"],
    [[2, 6, 2], [6, 6, 0], "strut"],
    [[2, 10, 0], [8, 6, 0], "cable"],
    [[4, 6, 2], [8, 6, 0], "strut"],
    [[4, 6, 2], [6, 6, 0], "strut"],
  ],
  tape: [],
};

/** The leg the rig stands on the anchor `(2, 0, 0)`. */
const LEG_ON_ANCHOR = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not stand a tower whose foot rests on a ground node that is not an anchor", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, RIG);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
  ]);

  const anchored = await h.check();
  assertTrue(
    anchored.stable,
    "the rig to stand with every foot on an anchor (specs/statics.md)",
  );

  await h.debug.removeMember(LEG_ON_ANCHOR);
  await h.debug.addMember(4, 0, 0, 2, 4, 0, "strut");
  const grounded = await h.check();
  await h.capture(
    "foot-off-the-anchor",
    "the rig with one leg standing on the ground node (4, 0, 0)",
  );

  assertLength(
    grounded.issues,
    0,
    "the issues of the crane standing on (4, 0, 0): the strut still runs to " +
      "the bottom flange, so it is ready (specs/structure.md)",
  );
  assertTrue(
    !grounded.stable,
    "the crane to stand on a ground node the site does not list as an " +
      "anchor: the ground is not a support (specs/statics.md)",
  );
  assertLength(
    grounded.members,
    0,
    "the members reported by a structure that does not stand " +
      "(specs/structure.md)",
  );
});
