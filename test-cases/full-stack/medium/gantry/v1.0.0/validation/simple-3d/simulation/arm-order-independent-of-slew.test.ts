// simulation/arm-order-independent-of-slew — the arm's nodes are eliminated in
// lattice order, not in the order the slew angle stands them in.
//
// specs/statics.md § Singularity fixes the elimination order: "K = L D L^T ...
// eliminating the unknowns node by node in ascending order of lattice position,
// by `x`, then `y`, then `z`, and within a node in the order `x`, `y`, `z`,
// exchanging no row and no column. ARM NODES ARE ORDERED BY THEIR LATTICE
// POSITIONS AND NOT BY WHERE THE SLEW ANGLE STANDS THEM, so the order is the same
// at every angle."
//
// WHAT THAT ORDER HAS TO MEAN IS THAT THE ANSWER DOES NOT MOVE WITH THE ANGLE.
// § Geometry at a tick turns the whole arm rigidly about the slew axis, and the
// loads the arm carries at rest are gravity and the cable force, both of them
// vertical and so unchanged by a turn about `y`. So the arm at slew `180` is the
// arm at slew `0` rotated, under the same loads, and every arm member must come
// back carrying exactly what it carried before. A build that ordered its arm
// nodes by where the slew stands them would eliminate in a different order at the
// two angles.
//
// THE READING IS TAKEN ON THE FIRST TICK OF TWO RUNS OF THE SAME CRANE, one left
// at slew `0` and one posed to `180`. The first tick is the quiet one: the bob
// hangs where the run started it, "on a run's first tick the acceleration is
// zero" (specs/rigging.md § The pendulum tick), so the cable force is the bare
// hook's weight straight down in both runs, and the axes carry no command that
// could turn them, so the slew rate and acceleration are `0` and the load model's
// inertial terms vanish.
//
// ONLY THE ARM'S MEMBERS ARE COMPARED. The tower's are legitimately different at
// the two angles: § The two solves carries each corner's reaction across the ring
// "in world components, negated and turned no further", so a reaction that has
// turned with the arm bears on the tower differently. The arm's own solve is what
// this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** First Lift: the minimal crane stands on it inside budget. */
const SITE = 0;

/**
 * Where MINIMAL_CRANE's arm begins in its member list: the mast, its four ties
 * to the top flange, the rail, and the three ties that hold the rail's far end.
 * Everything before it is the tower, which the ring transfer legitimately loads
 * differently at a different angle.
 */
const ARM_FROM = 13;

/** Half a turn: the angle a build ordering by rotated position would reverse. */
const HALF_TURN = 180;

/** A tape that keeps the run ticking and touches nothing the solve reads. */
const TURN_THE_GRIP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
  },
];

/** The point's own figure: forces here are hundreds of units. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solves the arm to the same member forces at slew 0 and at slew 180", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TURN_THE_GRIP);

  await startRun(h);
  const square = (await runTicks(h, 1)).run.forces;

  await h.debug.abortRun();
  await startRun(h);
  await h.debug.setAxis("slew", HALF_TURN);
  const turned = (await runTicks(h, 1)).run.forces;
  await h.capture("state", "The driven state this point decides");

  for (let id = ARM_FROM; id < MINIMAL_CRANE.members.length; id += 1) {
    const at0 = square.find((one) => one.id === id);
    const at180 = turned.find((one) => one.id === id);
    assertDefined(at0, `the force run.forces reports for arm member ${id}`);
    assertDefined(
      at180,
      `the force run.forces reports for arm member ${id} at slew ` +
        `${HALF_TURN}, the arm still standing`,
    );
    assertNear(
      at180?.force ?? Number.NaN,
      at0?.force ?? Number.NaN,
      TOLERANCE,
      `the force in arm member ${id} at slew ${HALF_TURN}, which is the arm ` +
        "at slew 0 turned rigidly under the same vertical loads " +
        "(specs/statics.md § Singularity)",
    );
  }
});
