// rigging/attach-missed-when-already-holding — a second `attach` while a load is
// on the hook ends the run.
//
// specs/rigging.md § Attaching closes with it: "One load is attached at a time;
// `attach` while a load is attached ends the run as `attach-missed`, since there
// is no free hook to attach with."
//
// THE SECOND LOAD IS WELL INSIDE REACH, WHICH IS WHAT MAKES THIS A READING OF THE
// RULE. It stands `0.3` from the hook point against an `ATTACH_RADIUS` of `0.8`,
// so the candidate search would find it happily; what refuses the lift is the hook
// already being full. A build that ran the search first and only then noticed the
// hook was taken would come away holding two loads, or swap one for the other, and
// either way carry on running.
//
// THE FIRST LOAD IS HUNG THROUGH THE SURFACE. specs/instrumentation.md:
// `setLoadPhase` to `"attached"` "hangs that load on the hook exactly as a
// successful `attach` leaves it, without the candidate search and without the
// `attach-missed` verdict" — so the state the tape's `attach` meets is exactly the
// state a successful lift leaves, reached without leaning on the rule under test.
//
// The hook itself is posed where the run starts it — the pivot minus
// `(0, HOIST_START, 0)`, which the cable holds at its current length — so the
// second load's `0.3` is the distance written here.
//
// The tape opens with a move whose target is the axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick
// that changes nothing, so the `attach` is not the run's own first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ATTACH_RADIUS,
  GRIP_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
} from "../constants";
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

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook is posed: where the run starts it, so the cable holds it. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The load hung on the hook before the tape's `attach` runs. */
const HELD = { x: HOOK.x, y: HOOK.y, z: HOOK.z, yaw: 0 };

/** The other load: waiting, and well inside ATTACH_RADIUS of the hook. */
const IN_REACH = { x: HOOK.x + 0.3, y: HOOK.y, z: HOOK.z, yaw: 0 };

const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that would keep a surviving run running past the `attach`. */
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

it("ends the run as attach-missed when a load is already on the hook", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.clearLoads();
  await h.debug.addLoad("crate", 40, HELD.x, HELD.y, HELD.z, HELD.yaw);
  await h.debug.addLoad(
    "crate",
    40,
    IN_REACH.x,
    IN_REACH.y,
    IN_REACH.z,
    IN_REACH.yaw,
  );
  await poseTape(h, [NOOP, ATTACH, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);
  await h.debug.setLoadPhase(0, "attached");

  const missed = await runTicks(h, 1);
  await h.capture(
    "state",
    "a second `attach` with load 0 on the hook and load 1 in reach",
  );

  assertEqual(
    missed.run.phase,
    "failed",
    "the run on the tick a second `attach` executed with a load already on " +
      `the hook and another waiting 0.3 away, inside ATTACH_RADIUS ` +
      `(${ATTACH_RADIUS}) (specs/rigging.md § Attaching)`,
  );
  assertEqual(
    missed.run.cause,
    "attach-missed",
    "the cause an `attach` with no free hook ends the run with " +
      "(specs/rigging.md § Attaching)",
  );
  assertEqual(
    missed.run.attached,
    0,
    "the load still on the hook: one load is attached at a time, so the " +
      "second `attach` took nothing (specs/rigging.md § Attaching)",
  );
});
