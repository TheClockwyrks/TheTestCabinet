// simulation/ring-adds-no-stiffness — the ring contributes no stiffness of its
// own, so no amount of arm above a bottom-flange node braces it.
//
// specs/statics.md, The two solves: the ring "contributes no stiffness to either
// solve: what holds the arm is the top flange it is supported on, and what holds
// the bottom flange is the tower's own members." `specs/structure.md` says the
// same of the part: "it adds no stiffness of its own".
//
// This is the near neighbour of the unreached-corner item, and it is deliberately
// asked the other way round. The crane starts with a bottom-flange corner nothing
// reaches, and is then made STIFFER ABOVE THE RING: five members tying the four
// top-flange nodes to one another, so the arm is a rigid frame bearing directly
// on the corner's own partner. If the ring carried any stiffness across, that
// frame would be exactly what braced the corner. It does not, and the reading
// after the bracing must be the same verdict as the reading before it.
//
// Both readings are taken with readiness satisfied and a tape posed, so
// `check.issues` is empty throughout and the verdict is the solve's alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  emptyYard,
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

/** The members ending at the bottom-flange corner `(0, 4, 0)`. */
const AT_CORNER = [0, 4, 6, 8];

/** A rigid frame across all four top-flange nodes, added above the ring. */
const TOP_FLANGE_FRAME = [
  [[0, 6, 0], [2, 6, 0]],
  [[0, 6, 2], [2, 6, 2]],
  [[0, 6, 0], [0, 6, 2]],
  [[2, 6, 0], [2, 6, 2]],
  [[0, 6, 0], [2, 6, 2]],
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not brace an unreached bottom-flange node through a stiffened arm", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await emptyYard(h);
  await poseCrane(h, RIG);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
  ]);
  for (const id of AT_CORNER) await h.debug.removeMember(id);

  const bare = await h.check();
  assertTrue(
    !bare.stable,
    "the crane to stand with a bottom-flange corner unreached " +
      "(specs/statics.md)",
  );

  for (const [a, b] of TOP_FLANGE_FRAME) {
    await h.debug.addMember(a[0], a[1], a[2], b[0], b[1], b[2], "strut");
  }
  const stiffened = await h.check();
  await h.capture(
    "arm-stiffened",
    "the rig with all four top-flange nodes tied together and the corner " +
      "(0, 4, 0) still unreached",
  );

  assertLength(
    stiffened.issues,
    0,
    "the issues of the stiffened crane, which is ready and has a tape " +
      "(specs/structure.md)",
  );
  assertTrue(
    !stiffened.stable,
    "the crane to stand once the arm is tied rigidly across all four " +
      "top-flange nodes: the ring carries no stiffness down to the bottom " +
      "flange (specs/statics.md)",
  );
});
