// simulation/trolley-mass-shared-along-the-member — the trolley's mass is shared
// between the two nodes of the rail it is on, linearly by its position along it.
//
// specs/statics.md, The load model: "`TROLLEY_MASS` (15) sits at the trolley
// point and is shared between the two nodes of the rail member the trolley is on,
// linearly by its position along that member", and the cable force is "shared
// between the same two rail nodes the trolley's mass is".
//
// Two readings on the same rail, the one from `(6, 6, 0)` to `(8, 6, 0)`, which
// the track covers from `2` to `4`: the trolley a quarter along it, and then
// three quarters along it. Both stand it strictly between the rail's ends, so
// neither reading touches the shared-node rule that the next item decides — what
// separates them is the sharing alone. Moving half a rail's length shifts half of
// what the trolley point carries from one end to the other, and the outboard
// node's cable is where that shows: it is the only member at `(8, 6, 0)` with a
// `y` component, so it carries the whole vertical load lumped there, and the
// difference between the two readings is exactly half of what the trolley point
// brings, resolved through the cable's own direction.
//
// What the trolley point brings is `TROLLEY_MASS` plus the cable force: each
// reading is a run's FIRST tick, where `specs/rigging.md` fixes the bob's
// acceleration at zero, so that force is the bare hook's weight straight down.
// A build that split the mass evenly whatever the position reads no difference at
// all between the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, fail } from "../assert";
import {
  GRAVITY,
  HOIST_MAX_RATE,
  HOIST_START,
  HOOK_MASS,
  TROLLEY_MASS,
} from "../constants";
import {
  clearAll,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type GantrySnapshot,
  type Harness,
  type MemberForce,
  type TapeStepSpec,
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

/** The mast head and the outboard track node its cable hangs. */
const MAST = [2, 10, 0] as const;
const OUTBOARD = [8, 6, 0] as const;

/** That cable, by the id `poseCrane` gives it. */
const CABLE_OUT = 26;

/** A quarter and three quarters along the rail the track covers from 2 to 4. */
const NEAR = 2.5;
const FAR = 3.5;

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

/**
 * Empty the tape, append `steps`, and start a run on them.
 *
 * The tape poses apply on the program screen alone (`specs/instrumentation.md`),
 * so the screen is taken there to empty it and put back before the start, which
 * `specs/program.md` allows from the build or the program screen.
 */
async function freshRun(steps: readonly TapeStepSpec[]): Promise<void> {
  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await h.debug.setScreen("build");
  await poseTape(h, steps);
  await startRun(h);
}

/** End the reading's run and stand back on the build screen. */
async function endRun(): Promise<void> {
  await h.debug.abortRun();
  await h.debug.setScreen("build");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One tick of a fresh run with the trolley posed at `position`. */
async function readAt(position: number): Promise<GantrySnapshot> {
  await freshRun([
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
  ]);
  await h.debug.setAxis("trolley", position);
  const s = await runTicks(h, 1);
  assertClose(
    s.run.axes.trolley.value,
    position,
    1e-9,
    "the trolley's position, which no command moves (specs/program.md)",
  );
  return s;
}

it("shifts the trolley's load between a rail's two nodes as it runs along it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await emptyYard(h);
  await poseCrane(h, RIG);

  const near = await readAt(NEAR);
  await endRun();
  const far = await readAt(FAR);
  await h.capture(
    "trolley-along-the-rail",
    "the run with the trolley three quarters along the outboard rail",
  );

  // Half a rail's length moves half of what the trolley point carries — its own
  // mass and the bare hook's weight — from the inboard node to the outboard one.
  const moved = ((TROLLEY_MASS + HOOK_MASS) * GRAVITY) / 2;
  assertClose(
    forceOf(far.run.forces, CABLE_OUT) - forceOf(near.run.forces, CABLE_OUT),
    moved / Math.abs(direction(OUTBOARD, MAST).y),
    1e-6,
    "how the cable hanging (8, 6, 0) moves as the trolley runs from a quarter " +
      "along its rail to three quarters along it (specs/statics.md)",
  );
});
