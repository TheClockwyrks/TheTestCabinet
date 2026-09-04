// simulation/counterweight-on-a-fallen-node-applies-nothing — a counterweight on
// a node in neither solve applies nothing.
//
// specs/statics.md, The two solves: "A node that no intact member ends at and no
// flange puts there belongs to neither solve: a counterweight left on such a node
// applies nothing." `specs/structure.md` says the same of the part: "What holds
// it is the structure at that node, so a counterweight left with nothing at its
// node falls."
//
// The scenario makes exactly the state that sentence describes and changes
// nothing else. A counterweight is placed on the outboard track node `(8, 6, 0)`,
// which the structure uses, and then every member ending at that node is removed
// — the outboard rail, its mast cable and its sideways brace. No member ends
// there any more and no flange puts a node there, so it belongs to neither solve,
// and the counterweight is left on it. The crane still stands: the two nodes those
// members also ran to keep three members each, the rail that remains still forms
// a single track, and every member left runs to an anchor or a flange node, so
// `check.issues` stays empty.
//
// The two readings are that crane with the counterweight and the same crane
// without it, so the ONLY difference between them is the counterweight on the
// fallen node. Every member must read identically. A build that lumped
// `COUNTERWEIGHT_MASS` at a node outside both solves — or that lumped it at the
// nearest node still in one — moves the numbers.
//
// The counterweight is read back off the structure first, because the whole
// reading turns on it still being there: a build that quietly dropped it when its
// node stopped being used would answer two identical readings for the wrong
// reason, and `specs/structure.md` removes a counterweight by a delete and by
// nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength, assertTrue } from "../assert";
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

/** The node the counterweight is left on, once nothing reaches it. */
const FALLEN = [8, 6, 0] as const;

/** Every member ending there: the outboard rail, its cable and its brace. */
const AT_FALLEN = [21, 26, 27];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("applies nothing from a counterweight on a node in neither solve", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, RIG);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
  ]);

  await h.debug.addCounterweight(FALLEN[0], FALLEN[1], FALLEN[2]);
  for (const id of AT_FALLEN) await h.debug.removeMember(id);

  const structure = (await h.snapshot()).structure;
  assertTrue(
    structure.counterweights.some(
      (node) =>
        node.x === FALLEN[0] && node.y === FALLEN[1] && node.z === FALLEN[2],
    ),
    "the counterweight to still stand on (8, 6, 0) once nothing reaches that " +
      "node: only a delete takes one off (specs/structure.md)",
  );
  assertTrue(
    !structure.members.some((member) =>
      [member.a, member.b].some(
        (end) =>
          end.x === FALLEN[0] && end.y === FALLEN[1] && end.z === FALLEN[2],
      ),
    ),
    "any member still ending at (8, 6, 0) (specs/statics.md)",
  );

  const withWeight = await h.check();
  await h.capture(
    "counterweight-left-behind",
    "the counterweight left on a node no member reaches",
  );
  assertLength(
    withWeight.issues,
    0,
    "the issues of the crane the members were taken from " +
      "(specs/structure.md)",
  );
  assertTrue(
    withWeight.stable,
    "the crane to stand, so the check reports every member " +
      "(specs/structure.md)",
  );

  await h.debug.removeCounterweight(FALLEN[0], FALLEN[1], FALLEN[2]);
  const without = await h.check();

  assertLength(
    without.members,
    withWeight.members.length,
    "the members reported with and without the counterweight",
  );
  for (const [index, member] of without.members.entries()) {
    const loaded = withWeight.members[index];
    assertClose(
      loaded?.force ?? Number.NaN,
      member.force,
      1e-6,
      `member ${member.id}'s force, which a counterweight on a node in ` +
        "neither solve cannot reach (specs/statics.md)",
    );
  }
});
