// simulation/member-force-negative-in-compression — the same figure is negative
// when the member is in compression.
//
// specs/statics.md, The two solves: the axial force is "positive in tension,
// negative in compression".
//
// The member read is the vertical leg under the bottom-flange corner
// `(0, 4, 0)`. That corner is reached by its leg and by horizontal members alone,
// so the node's vertical equilibrium bears on the leg and on nothing else: with
// the leg running straight down to its anchor, its force is exactly the vertical
// force applied at the node. Hanging weight there therefore drives the number the
// leg reports DOWN by exactly what was hung, and a leg pressed down on to its
// anchor reports a figure below zero.
//
// The weight is one counterweight, `COUNTERWEIGHT_MASS` (80) at that node, which
// `specs/statics.md` lumps there and applies as `m * g`. Reading the leg with and
// without it is what makes this a measurement of the sign rather than of the rig:
// the difference between the two readings is a figure the specification states,
// and a build that reported compression as positive would show the leg's force
// RISE by that same 800 as weight was hung on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLessThan, assertTrue, fail } from "../assert";
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

/** The leg under the bottom-flange corner no diagonal reaches. */
const LEG = 0;

/** That corner: reached by its leg and by horizontals alone. */
const CORNER = [0, 4, 0] as const;

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

it("reports a negative force in a tower leg pressed down on its anchor", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await emptyYard(h);
  await poseCrane(h, RIG);

  const bare = await h.check();
  assertTrue(
    bare.stable,
    "the rig to stand, so the check reports every member (specs/structure.md)",
  );

  await h.debug.addCounterweight(CORNER[0], CORNER[1], CORNER[2]);
  const loaded = await h.check();
  assertTrue(
    loaded.stable,
    "the rig to stand with the counterweight on the corner " +
      "(specs/structure.md)",
  );
  await h.capture(
    "leg-in-compression",
    "the rig with a counterweight on the bottom-flange corner (0, 4, 0)",
  );

  const force = forceOf(loaded.members, LEG);
  assertLessThan(
    force,
    0,
    "the force in the leg under (0, 4, 0) carrying the counterweight down to " +
      "its anchor (specs/statics.md)",
  );
  assertClose(
    force - forceOf(bare.members, LEG),
    -(COUNTERWEIGHT_MASS * GRAVITY),
    1e-6,
    "how that leg's force moves when COUNTERWEIGHT_MASS is hung at the one " +
      "node it holds up (specs/statics.md)",
  );
});
