// simulation/trolley-mass-at-a-shared-node — at a node two rails share, the
// trolley's mass belongs wholly to that node.
//
// specs/statics.md, The load model: "The trolley's `TROLLEY_MASS` sits at the
// trolley point and is shared between the two nodes of the rail member the
// trolley is on, linearly by its position along that member; at a shared node it
// belongs wholly to that node." The cable force follows it: "The cable force from
// `specs/rigging.md` is applied at the trolley point and shared between the same
// two rail nodes the trolley's mass is."
//
// The rig's track runs `(4, 6, 0)-(6, 6, 0)-(8, 6, 0)`, so `trolley` `2` stands
// the trolley exactly on the node the two rails share. Each of the three track
// nodes is hung from the mast by one cable, the only member there with a `y`
// component, so each cable's force is the whole vertical load lumped at its node
// resolved through its own direction — and the three cables read together say
// where the trolley's fifteen went. At the shared node the cable must carry the
// whole of it, and at the far end of each of the two rails the cable must carry
// none: a build that split the mass across either rail's far end moves all three
// numbers.
//
// The reading is the run's FIRST tick, where `specs/rigging.md` fixes the bob's
// acceleration at zero, so the cable force is the bare hook's weight straight
// down, `HOOK_MASS * GRAVITY`, and it lumps at the same node the trolley's mass
// does.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, fail } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  GRAVITY,
  HOIST_MAX_RATE,
  HOIST_START,
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
  poseTape,
  runTicks,
  startRun,
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

/** The mast head, and the three track nodes it hangs by one cable each. */
const MAST = [2, 10, 0] as const;
const ORIGIN = [4, 6, 0] as const;
const SHARED = [6, 6, 0] as const;
const OUTBOARD = [8, 6, 0] as const;

/** Those three cables, by the id `poseCrane` gives them. */
const CABLE_ORIGIN = 22;
const CABLE_SHARED = 24;
const CABLE_OUT = 26;

/** The trolley position that stands it on the node the two rails share. */
const AT_SHARED = 2;

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

it("lumps the whole trolley mass at the node two rails share", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, RIG);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
  ]);

  await startRun(h);
  await h.debug.setAxis("trolley", AT_SHARED);
  const s = await runTicks(h, 1);
  await h.capture(
    "trolley-on-the-shared-node",
    "the run with the trolley standing on the node its two rails share",
  );

  assertClose(
    s.run.axes.trolley.value,
    AT_SHARED,
    1e-9,
    "the trolley's position, which no command moves (specs/program.md)",
  );

  // On the shared node: its own members' half masses, the whole of the
  // trolley's, and the bare hook's weight the cable brings with it.
  const hung = (HOOK_MASS + TROLLEY_MASS) * GRAVITY;
  assertClose(
    forceOf(s.run.forces, CABLE_SHARED),
    (memberMassAt(SHARED) * GRAVITY + hung) /
      Math.abs(direction(SHARED, MAST).y),
    1e-6,
    "the cable hanging (6, 6, 0), which carries the whole of the trolley's " +
      "mass because the trolley stands on that node (specs/statics.md)",
  );

  // And at the far end of each of the two rails it stands on: none of it.
  assertClose(
    forceOf(s.run.forces, CABLE_ORIGIN),
    (memberMassAt(ORIGIN) * GRAVITY) / Math.abs(direction(ORIGIN, MAST).y),
    1e-6,
    "the cable hanging (4, 6, 0), the far end of one of the two rails " +
      "(specs/statics.md)",
  );
  assertClose(
    forceOf(s.run.forces, CABLE_OUT),
    (memberMassAt(OUTBOARD) * GRAVITY) / Math.abs(direction(OUTBOARD, MAST).y),
    1e-6,
    "the cable hanging (8, 6, 0), the far end of the other (specs/statics.md)",
  );
});
