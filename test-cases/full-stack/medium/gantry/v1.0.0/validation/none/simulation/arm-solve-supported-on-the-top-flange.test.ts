// simulation/arm-solve-supported-on-the-top-flange — the arm's supports are the
// four top-flange nodes, so nothing below the ring reaches it.
//
// specs/statics.md, The two solves: "The arm solve. Nodes: the arm's, at their
// rotated positions. Supports: the four top-flange nodes." A support node is
// "held at zero displacement", so whatever the tower does under it, the arm's own
// displacements — and therefore every arm member's force — are unchanged.
//
// The change made below the ring is deliberately of both kinds the tower can
// offer: two more members, which stiffen it, and two counterweights on its
// bottom-flange nodes, which weigh it down. Either would reach the arm through a
// build that solved the two together, or that supported the arm on anything but
// the top flange; both leave a correct build's arm exactly where it was. The
// tower's own forces are read as well, and must move — otherwise the change was
// not a change and the reading proves nothing.
//
// The arm's members are the ids from the mast head onwards: `poseCrane` places
// the design in order, so an id is its index in the list above, and the tower's
// thirteen come first.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertTrue, fail } from "../assert";
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

/** The first arm member: every id at or above it belongs to the arm solve. */
const FIRST_ARM_MEMBER = 13;

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

it("leaves every arm member's force alone when the tower below changes", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await emptyYard(h);
  await poseCrane(h, RIG);

  const light = await h.check();
  assertTrue(
    light.stable,
    "the rig to stand, so the check reports every member (specs/structure.md)",
  );

  // Two more tower members, and two counterweights on bottom-flange nodes:
  // stiffer and heavier, and every bit of it below the ring.
  await h.debug.addMember(2, 0, 0, 0, 4, 0, "strut");
  await h.debug.addMember(0, 0, 2, 0, 4, 0, "strut");
  await h.debug.addCounterweight(2, 4, 0);
  await h.debug.addCounterweight(0, 4, 2);

  const heavy = await h.check();
  assertTrue(
    heavy.stable,
    "the stiffened, weighted tower to stand (specs/structure.md)",
  );
  await h.capture(
    "tower-changed",
    "the rig with the tower stiffened and weighted below the ring",
  );

  for (const member of light.members) {
    if (member.id < FIRST_ARM_MEMBER) continue;
    assertClose(
      forceOf(heavy.members, member.id),
      member.force,
      1e-6,
      `arm member ${member.id}'s force, which the tower below the ring cannot ` +
        "reach (specs/statics.md)",
    );
    const after = heavy.members.find((one) => one.id === member.id);
    assertClose(
      after?.utilization ?? Number.NaN,
      member.utilization,
      1e-6,
      `arm member ${member.id}'s utilization (specs/statics.md)`,
    );
  }

  const towerMoved = light.members.some(
    (member) =>
      member.id < FIRST_ARM_MEMBER &&
      Math.abs(forceOf(heavy.members, member.id) - member.force) > 1e-6,
  );
  assertTrue(
    towerMoved,
    "the tower's own forces to move, so the change below the ring was a real " +
      "one (specs/statics.md)",
  );
});
