// tape/pipeline-first-failure-wins — the stages below a tick's first failure do
// not run.
//
// `specs/program.md` § The tick pipeline: "The first failure a tick reaches ends
// the run with that cause and the later stages of that tick do not run." The
// rigging is stage 4 and the solves are stage 6, so a tick whose cable snaps
// solves nothing and breaks nothing.
//
// THE FAILURE IS THE RIGGING'S, AND IT IS REACHED BY MOVING THE PIVOT. The arm is
// stood at ninety degrees with `setAxis`, which "sets an axis's value, leaving it
// stopped with no live command" and poses a precondition rather than an outcome
// (`specs/instrumentation.md`). The next tick's geometry therefore carries the
// pivot right round the slew axis in one tick, and `specs/rigging.md`'s pendulum
// reads that as a pivot velocity of `(P - P_prev) / dt` — hundreds of units a
// second, so the tension `T = m * (a - g)` runs to tens of thousands and passes
// `HOIST_CABLE_CAP` (`3000`), which "snaps the cable and ends the run as
// `cable-snap`".
//
// WHY THAT MAKES THE LATER STAGES VISIBLE. `specs/statics.md` applies `-T` to the
// structure at the trolley point, "shared between the same two rail nodes the
// trolley's mass is" — so with the trolley standing OUT ALONG THE RAIL, past the
// outermost top-flange node the arm solve is supported on, most of that force
// goes onto the rail's far node, which the crane's own members carry rather than
// a support. A tension of that size against member capacities of `2400` would
// take utilizations far past `1`, and "every member whose utilization exceeds `1`
// breaks". So a build that ran its solves after the snap would report members
// broken and a fresh set of forces; a build that stopped at the failure reports
// the tick before's forces and an untouched broken list.
//
// THE TROLLEY IS THE ONE THING HERE THAT IS DRIVEN RATHER THAN POSED. `setAxis`
// would put it out along the rail in a single call, but that would carry the
// pivot units of yard in one tick, and a pivot that jumps is exactly what
// `specs/rigging.md` turns into the tension this point is about: the pose would
// manufacture the snap it means to observe. So the axis controller drives it, and
// only as far as the reading needs — the drive stops while the command is still
// live, the moment the trolley stands clear of the flange, rather than running on
// to the end of the track. Those ticks are driven in ONE batched call and nothing
// is read off them but the position they left: they are the route to the
// scenario, not the scenario.
//
// The yard is emptied and the crane is the minimal one: the requirement is about
// the order of the stages, so nothing else stands in the world.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { GRIP_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
import {
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

/** The far end of the minimal crane's four-unit track. */
const TROLLEY_TARGET = 4;

/** Where the arm is stood before the failing tick. */
const TURNED = 90;

/** Drive the trolley out, then turn the grip: a step that outlives the reading. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "trolley", target: TROLLEY_TARGET, rate: TROLLEY_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [{ axis: "grip", target: 90, rate: GRIP_MAX_RATE }],
  },
];

/**
 * Ticks the trolley is driven for, and how far out that has to leave it.
 *
 * The track runs from the top-flange node at `(0, 4, 0)` to the rail tip at
 * `(4, 4, 0)`, and the flange square reaches to `x = 2` — so a trolley past `2`
 * is past every support the arm solve stands on and the cable force at the
 * trolley point is shared mostly onto the rail's far node. `specs/program.md`'s
 * controller, at `TROLLEY_ACCEL` and `TROLLEY_MAX_RATE`, covers the first two
 * units in sixty ticks and is braking through the third, so this many ticks
 * leaves it comfortably clear of `CLEAR_OF_THE_FLANGE` with its command still
 * live — which is all the reading needs, and less than half of what running the
 * step to its end would have cost.
 */
const DRIVEN = 76;
const CLEAR_OF_THE_FLANGE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solves nothing and breaks nothing on the tick a snapping cable ends", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const before = await runTicks(h, DRIVEN);
  assertEqual(
    before.run.phase,
    "running",
    "the run before the failing tick is posed",
  );
  assertGreaterThan(
    before.run.axes.trolley.value,
    CLEAR_OF_THE_FLANGE,
    "the trolley's position along the track before the failing tick: past " +
      "the outermost top-flange node the arm solve is supported on, so the " +
      "cable force at the trolley point is shared mostly onto a node the " +
      "crane's own members carry (specs/statics.md)",
  );
  assertGreaterThan(
    before.run.forces.length,
    0,
    "the members the solve before the failure reported",
  );

  await h.debug.setAxis("slew", TURNED);
  const failed = await runTicks(h, 1);

  await h.capture(
    "state",
    "The tick a rigging failure ended, and its readouts",
  );

  assertEqual(
    failed.run.phase,
    "failed",
    "the run after a tick that carries the pivot right round in one tick",
  );
  assertEqual(
    failed.run.cause,
    "cable-snap",
    "the cause the rigging stage raises past HOIST_CABLE_CAP " +
      "(specs/rigging.md), which is the first failure this tick reaches",
  );
  assertDeepEqual(
    failed.run.broken,
    before.run.broken,
    "run.broken on the failing tick: the solves are stage 6 and the rigging " +
      "is stage 4, so no member broke on the tick the cable snapped " +
      "(specs/program.md)",
  );
  assertDeepEqual(
    failed.run.forces,
    before.run.forces,
    "run.forces on the failing tick: no solve ran below the failure, so the " +
      "forces are still the tick before's (specs/program.md)",
  );
});
