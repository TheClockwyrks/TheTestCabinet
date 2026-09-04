// simulation/reaction-crosses-the-corner-negated — a corner carries the reaction
// read at its top-flange node down to its bottom-flange node, negated, and to no
// other corner.
//
// specs/statics.md, The two solves: the tower's applied forces are its own lumped
// masses "plus, at each bottom-flange node, the negated reaction read at the
// top-flange node it shares a ring corner with... The reaction crosses the corner
// as it was read, in world components, negated and turned no further."
//
// The load is one counterweight placed on a TOP-FLANGE node. A top-flange node is
// a support of the arm solve, held at zero displacement, so weight hung there
// changes no arm displacement and no arm member force: it goes wholly into that
// support's reaction, which the arm solve reads back as "minus the sum of the
// applied force there and every member force pulling on it". `COUNTERWEIGHT_MASS`
// (80) at a support therefore moves that one reaction by exactly `800` upward,
// and the tower is handed exactly `800` downward at the bottom-flange node the
// ring pairs it with.
//
// What makes that arrive as a number rather than as an argument is the corner the
// counterweight is put over: `(0, 6, 0)` pairs with `(0, 4, 0)`, whose only
// non-horizontal member is its vertical leg, so that leg's force is exactly the
// vertical force applied at the node. The leg must therefore move by exactly
// `-800`.
//
// And "nowhere else" is read the same way round: the same counterweight on the
// NEIGHBOURING top-flange node `(2, 6, 0)` crosses at its own corner, so the leg
// under `(0, 4, 0)` must not move at all. A build that spread the reaction over
// the flange, or that paired the corners by where the nodes currently stand
// rather than by the ring's own pairing, fails one reading or the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertTrue, fail } from "../assert";
import { COUNTERWEIGHT_MASS, GRAVITY } from "../constants";
import {
  clearAll,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
  type MemberForce,
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

/** The leg under `(0, 4, 0)`, the corner reached by horizontals and it alone. */
const LEG = 0;

/** The top-flange node that corner is paired with, and its neighbour. */
const PARTNER = [0, 6, 0] as const;
const NEIGHBOUR = [2, 6, 0] as const;

/** The force the reported member list carries for `id`. */
function forceOf(members: readonly MemberForce[], id: number): number {
  const found = members.find((one) => one.id === id);
  if (found === undefined) {
    fail(`member ${id} to be reported (specs/state.md)`, "it is missing");
  }
  return found.force;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries a top-flange load down to its own bottom-flange node, negated", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await emptyYard(h);
  await poseCrane(h, RIG);

  const bare = await h.check();
  assertTrue(
    bare.stable,
    "the rig to stand, so the check reports every member (specs/structure.md)",
  );
  const before = forceOf(bare.members, LEG);

  await h.debug.addCounterweight(PARTNER[0], PARTNER[1], PARTNER[2]);
  const onPartner = await h.check();
  await h.capture(
    "load-over-the-corner",
    "the rig with a counterweight on the top-flange node (0, 6, 0)",
  );
  assertTrue(
    onPartner.stable,
    "the rig to stand with the counterweight on (0, 6, 0) " +
      "(specs/structure.md)",
  );
  assertClose(
    forceOf(onPartner.members, LEG) - before,
    -(COUNTERWEIGHT_MASS * GRAVITY),
    1e-6,
    "how the leg under (0, 4, 0) moves when COUNTERWEIGHT_MASS is hung on the " +
      "top-flange node its corner pairs it with (specs/statics.md)",
  );
  await h.debug.removeCounterweight(PARTNER[0], PARTNER[1], PARTNER[2]);

  await h.debug.addCounterweight(NEIGHBOUR[0], NEIGHBOUR[1], NEIGHBOUR[2]);
  const onNeighbour = await h.check();
  assertTrue(
    onNeighbour.stable,
    "the rig to stand with the counterweight on (2, 6, 0) " +
      "(specs/structure.md)",
  );
  assertClose(
    forceOf(onNeighbour.members, LEG) - before,
    0,
    1e-6,
    "how the leg under (0, 4, 0) moves when the same weight is hung on a " +
      "DIFFERENT corner's top-flange node: the reaction crosses at its own " +
      "corner and nowhere else (specs/statics.md)",
  );
});
