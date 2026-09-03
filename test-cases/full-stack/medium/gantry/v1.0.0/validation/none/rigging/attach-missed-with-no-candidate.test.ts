// rigging/attach-missed-with-no-candidate — an `attach` that finds nothing ends
// the run.
//
// specs/rigging.md § Attaching: the candidate is the `waiting` load nearest the
// hook point "if that distance is at most `ATTACH_RADIUS` (`0.8`)", and "With no
// candidate, the run ends as `attach-missed`." So an `attach` is not a no-op that
// the tape carries on past: it is a verdict.
//
// THE YARD HOLDS ONE LOAD, AND IT IS OUT OF REACH. Emptying the yard entirely
// would decide the point too, but a yard with a load in it decides more of it: a
// build that ends the run only when there is nothing in the yard at all, rather
// than nothing within `ATTACH_RADIUS` of the hook, carries on here. The load
// stands `10` units from the hook point, better than twelve times the radius, so
// no reading of the distance brings it inside.
//
// THE HOOK POINT IS POSED, so the distance is the one written here and not one
// that depends on where a tick left the bob. `setBob` "puts the bob where it is
// asked for", and the position asked for is the one the run starts at — the pivot
// minus `(0, HOIST_START, 0)` — so the cable holds it and nothing moves.
//
// The tape opens with a move whose target is the axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one
// tick that changes nothing, so the `attach` is not the run's own first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  ATTACH_RADIUS,
  GRIP_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook is posed: where the run starts it, so the cable holds it. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The one load in the yard, far outside any reading of ATTACH_RADIUS. */
const LOAD_AT = { x: 10, y: 2, z: 0, yaw: 0 };

/** A move whose target is the axis's value: one tick, and nothing moves. */
const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that keeps a surviving run running, so an `attach` that did not end
 * the run is visibly still running rather than ending for want of a tape. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as attach-missed when no waiting load is in reach", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, LOAD_AT, LOAD_AT);
  await poseTape(h, [NOOP, ATTACH, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);

  const missed = await runTicks(h, 1);
  await h.capture(
    "state",
    `the hook ${distance3(HOOK, LOAD_AT)} from the only load in the yard`,
  );

  assertEqual(
    missed.run.phase,
    "failed",
    "the run on the tick an `attach` executed with the only waiting load " +
      `${distance3(HOOK, LOAD_AT)} from the hook point, against an ` +
      `ATTACH_RADIUS of ${ATTACH_RADIUS} (specs/rigging.md § Attaching)`,
  );
  assertEqual(
    missed.run.cause,
    "attach-missed",
    "the cause an `attach` with no candidate ends the run with " +
      "(specs/rigging.md § Attaching)",
  );
  assertNull(
    missed.run.attached,
    "what the hook came away with: nothing was in reach to take",
  );
});
