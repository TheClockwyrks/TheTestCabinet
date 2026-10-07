// rigging/release-yaw-difference-is-never-negative — a load turned the long way
// short of its pad is that far off, not that far under zero.
//
// specs/rigging.md, Releasing, defines the yaw difference: "their difference in
// degrees brought into `0` up to but not including `360`, then subtracted from
// `360` when it comes out above `180`. It is NEVER NEGATIVE and never above
// `180`". The sign is the whole point. A build that keeps the signed difference
// and tests it against `PLACE_YAW_TOL` reads a load `170` degrees short of its
// pad as `-170`, which is comfortably "at most `10`", and sets it down backwards.
//
// `170` DEGREES SHORT is chosen because it is where the two readings disagree
// most loudly and unambiguously: the wrapped difference is `170`, seventeen times
// `PLACE_YAW_TOL` (`10`), so a build that wraps cannot place it; a signed `-170`
// passes an `at most 10` test outright. It is also short of `180`, so it is one
// definite way round the circle rather than the pair the half turn would leave.
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

/** How far short of the pad's yaw the load is turned. */
const SHORT_BY = 170;

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

it("misplaces a load turned 170 degrees short of its target yaw", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, PAD);
  await poseTape(h, TAPE);
  await startRun(h);
  await hangOnHook(h, 0, DROP);

  const after = await runTicks(h, 1);
  await h.capture("yaw", "The load turned the long way round on its pad");

  assertEqual(
    after.run.cause,
    "release-misplaced",
    `a load ${SHORT_BY} degrees short of its target yaw: the wrapped ` +
      `difference is ${SHORT_BY}, past PLACE_YAW_TOL (${PLACE_YAW_TOL}), ` +
      `where a signed -${SHORT_BY} would have passed an "at most ` +
      `${PLACE_YAW_TOL}" test (specs/rigging.md)`,
  );
});
