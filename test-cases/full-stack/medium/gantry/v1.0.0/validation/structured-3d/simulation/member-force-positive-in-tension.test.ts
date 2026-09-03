// simulation/member-force-positive-in-tension — the axial force a solve reports
// is positive when the member is in tension.
//
// specs/statics.md, The two solves: "The member's axial force
// `N = (EA / L) * dot(u_q - u_p, n)` [is] positive in tension, negative in
// compression."
//
// The member read is the mast cable hanging the outboard track node `(8, 6, 0)`.
// A cable pulls and never pushes, so a cable holding a node up is in tension
// whatever else the crane is doing — and this one's force is not merely positive
// but exactly predictable, which is what makes the reading a measurement of the
// sign convention rather than a guess at it. The only member at that node with a
// `y` component is the cable: the rail and the sideways brace are both
// horizontal. So the node's vertical equilibrium fixes the cable's force at
// `V / |n.y|` for the vertical load `V` lumped there, and `specs/statics.md`
// fixes that load — the static check reads the run-start posture, `trolley` `0`
// with the bare hook hanging from it, so the trolley's mass and the cable force
// it carries lump at the track origin `(4, 6, 0)` and nowhere near this node,
// leaving it the half masses of its own three members alone.
//
// A build that reported tension as negative answers this magnitude with the wrong
// sign, and one that resolved the load through the wrong direction answers the
// wrong magnitude.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertGreaterThan, assertTrue, fail } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  GRAVITY,
  RAIL_MASS_PER_UNIT,
  STRUT_MASS_PER_UNIT,
} from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
  type MaterialName,
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

/** The mast cable hanging the outboard track node. */
const CABLE_OUT = 26;

/** The node it hangs, and the mast head it hangs from. */
const HUNG = [8, 6, 0] as const;
const MAST = [2, 10, 0] as const;

/** Each material's mass per unit (`specs/structure.md`). */
const MASS_PER_UNIT: Readonly<Record<MaterialName, number>> = {
  strut: STRUT_MASS_PER_UNIT,
  cable: CABLE_MASS_PER_UNIT,
  rail: RAIL_MASS_PER_UNIT,
};

/**
 * The mass the rig's own members lump at a node: half of every member ending
 * there, each half its length times its material's mass per unit
 * (`specs/statics.md`, The load model).
 */
function memberMassAt(node: readonly [number, number, number]): number {
  let mass = 0;
  for (const member of RIG.members) {
    const length = Math.hypot(
      member[0][0] - member[1][0],
      member[0][1] - member[1][1],
      member[0][2] - member[1][2],
    );
    for (const end of [member[0], member[1]]) {
      if (end[0] === node[0] && end[1] === node[1] && end[2] === node[2]) {
        mass += (length * MASS_PER_UNIT[member[2]]) / 2;
      }
    }
  }
  return mass;
}

/** The unit direction from `from` towards `to`. */
function direction(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): { x: number; y: number; z: number } {
  const d = { x: to[0] - from[0], y: to[1] - from[1], z: to[2] - from[2] };
  const length = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / length, y: d.y / length, z: d.z / length };
}

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

it("reports a positive force in a mast cable hanging a rail node", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, RIG);

  const result = await h.check();
  assertTrue(
    result.stable,
    "the rig to stand, so the check reports every member (specs/structure.md)",
  );
  await h.capture(
    "cable-in-tension",
    "the rig whose mast cable hangs the outboard rail node",
  );

  const force = forceOf(result.members, CABLE_OUT);
  assertGreaterThan(
    force,
    0,
    "the force in the mast cable hanging (8, 6, 0), which can only pull " +
      "(specs/statics.md)",
  );

  // The whole vertical load lumped at that node, resolved through the cable's
  // own direction: every other member there is horizontal.
  const expected =
    (memberMassAt(HUNG) * GRAVITY) / Math.abs(direction(HUNG, MAST).y);
  assertClose(
    force,
    expected,
    1e-6,
    "the cable's force, V / |n.y| for the load V lumped at (8, 6, 0) " +
      "(specs/statics.md)",
  );
});
