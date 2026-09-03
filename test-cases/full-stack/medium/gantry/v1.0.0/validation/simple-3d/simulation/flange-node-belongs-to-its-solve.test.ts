// simulation/flange-node-belongs-to-its-solve — a bottom-flange node no member
// reaches is still a node of the tower solve, with nothing holding it.
//
// specs/statics.md, The two solves: "A flange node belongs to its solve whether
// or not a member ends there, since it carries ring mass and, on the bottom
// flange, the force carried across." A node in the solve with no member ending at
// it has no stiffness at all, so the supported system has unknowns and nothing to
// resist them — which `specs/statics.md`, Singularity, settles outright: "A
// supported system that has unknowns and no stiffness anywhere has a largest
// diagonal of `0` and a first pivot of `0`, so it is singular."
//
// The scenario removes every member ending at one bottom-flange corner and leaves
// the other three carried exactly as they were. Nothing about readiness changes:
// the crane still has its ring, its rails still form a track, and every member
// left has a path to an anchor or a flange node, so `check.issues` stays empty
// (`specs/structure.md`) — which is the point. Readiness is the editor's verdict
// and standing is the solve's, and here the two part company.
//
// The tape is posed so that `empty-program` is not among the issues either, and
// the crane is read before the removal as well, so a build that never stands
// anything cannot pass by accident.

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not stand when a bottom-flange node has no member reaching it", async () => {
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

  const whole = await h.check();
  assertLength(
    whole.issues,
    0,
    "the issues of the whole rig, which is ready and has a tape " +
      "(specs/structure.md)",
  );
  assertTrue(whole.stable, "the whole rig to stand (specs/statics.md)");

  for (const id of AT_CORNER) await h.debug.removeMember(id);
  const unreached = await h.check();
  await h.capture(
    "corner-unreached",
    "the rig with nothing reaching the bottom-flange corner (0, 4, 0)",
  );

  assertLength(
    unreached.issues,
    0,
    "the issues with the corner unreached: every member left still runs to an " +
      "anchor or a flange node, so readiness is satisfied " +
      "(specs/structure.md)",
  );
  assertTrue(
    !unreached.stable,
    "the crane to stand, when a bottom-flange node of the tower solve has no " +
      "stiffness at all (specs/statics.md)",
  );
  assertLength(
    unreached.members,
    0,
    "the members reported by a structure that does not stand " +
      "(specs/structure.md)",
  );
});
