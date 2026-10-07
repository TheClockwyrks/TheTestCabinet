// rigging/release-yaw-difference-wraps-past-360 — a load turned almost a full
// turn round is a few degrees off, not almost a full turn off.
//
// specs/rigging.md, Releasing: "The wrapped difference between two yaws is the
// shorter way round the circle: their difference in degrees brought into `0` up
// to but not including `360`, then subtracted from `360` when it comes out above
// `180`." A yaw is an angle, and angles a whole turn apart are the same angle, so
// a load turned `355` degrees short of the yaw its pad asks for is standing `5`
// degrees round from it. A build that takes the plain absolute difference reads
// `355`, seventy-one times `PLACE_YAW_TOL` (`10`), and refuses a load that is all
// but square on its pad.
//
// `5` DEGREES OFF AFTER THE WRAP, and not the `10` that a difference of exactly
// `350` would leave. What is being decided here is that the difference wraps at
// all; whether the bound is inclusive is another point's, and a scenario that
// landed exactly on the bound would fail for either reason and name neither.
//
// EVERY OTHER TEST IS SATISFIED, so the yaw is the only thing that can decide the
// verdict: the bob stands exactly on the pad, at rest.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLACE_YAW_TOL } from "../constants";
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
  type LoadPose,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The pad, directly under the minimal crane's pivot, resting on the ground. */
const PAD: LoadPose = { x: 0, y: 2, z: 0, yaw: 0 };

/** Where the load waits before it is hung on the hook. */
const START: LoadPose = { x: 6, y: 2, z: 0, yaw: 0 };

/** How far short of the pad's yaw the load is turned: all but a full turn. */
const SHORT_BY = 355;

/** What that is once it is brought round the shorter way. */
const WRAPPED = 360 - SHORT_BY;

/** On the pad, turned `SHORT_BY` degrees short of the yaw it asks for. */
const DROP: LoadPose = { ...PAD, yaw: PAD.yaw - SHORT_BY };

/** The tape: one release, taken and executed on the run's first tick. */
const TAPE: readonly TapeStepSpec[] = [{ kind: "action", action: "release" }];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Hang load `index` on the hook at `pose`, at rest.
 *
 * `specs/instrumentation.md`: `setLoadPhase` to `"attached"` "hangs that load on
 * the hook exactly as a successful `attach` leaves it", and `specs/rigging.md`
 * has "the attached load's lift point" and the hook point both at the bob's
 * position, with the load's yaw the grip's value — so the load's pose is set to
 * the bob's alongside it, and the hoist axis to "the distance it left between the
 * pivot and the bob" so the cable can hold it there.
 */
async function hangOnHook(
  harness: Harness,
  index: number,
  pose: LoadPose,
): Promise<void> {
  const { pivot } = (await harness.snapshot()).run;
  await harness.debug.setBob(pose.x, pose.y, pose.z);
  await harness.debug.setBobVelocity(0, 0, 0);
  await harness.debug.setAxis("hoist", distance3(pivot, pose));
  await harness.debug.setAxis("grip", pose.yaw);
  await harness.debug.setLoadPhase(index, "attached");
  await harness.debug.setLoadPose(index, pose.x, pose.y, pose.z, pose.yaw);
}

it("places a load turned 355 degrees short of its target yaw", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, PAD);
  await poseTape(h, TAPE);
  await startRun(h);
  await hangOnHook(h, 0, DROP);

  const after = await runTicks(h, 1);
  await h.capture("wrap", "The load 355 degrees round from its pad");

  assertEqual(
    after.run.loads[0]?.phase,
    "placed",
    `a load ${SHORT_BY} degrees short of its target yaw: the wrapped ` +
      `difference is the shorter way round, ${WRAPPED}, inside ` +
      `PLACE_YAW_TOL (${PLACE_YAW_TOL}), where an unwrapped ${SHORT_BY} ` +
      "would have failed (specs/rigging.md)",
  );
});
