// rigging/release-places-at-exactly-the-target — a placed load snaps to its pad.
//
// specs/rigging.md, Releasing: "If all three hold, the load is `placed`: it
// leaves the hook, sits at exactly its target pose for the rest of the run".
// EXACTLY: a release inside the tolerances is not a release that leaves the load
// where it happened to be hanging. The tolerances say which releases succeed; a
// release that succeeds sets the load down on the pad itself, at the pad's yaw.
// `specs/world.md` says the same thing from the load's side: "A placed load sits
// at exactly its target pose for the rest of the run."
//
// SO THE RELEASE IS POSED OFF THE PAD, INSIDE EVERY TOLERANCE. A release already
// on the target would pass whether or not the build moved the load, which decides
// nothing. Here the bob stands `0.3` units from the pad against `PLACE_POS_TOL`
// (`0.5`), the grip is `5` degrees round from the pad's yaw against
// `PLACE_YAW_TOL` (`10`), and the bob is moving at `0.3` units a second against
// `PLACE_VEL_TOL` (`0.6`) — every test inside its bound, and every one of them
// something the load has to be moved off to reach its pad.
//
// THE PAD IS READ BACK EXACTLY, with no tolerance of its own. The pose is a
// figure the specification hands the build rather than one it computes: the
// target this scenario set, unrounded.
//
// ONE LOAD, NO OBSTACLES, the smallest crane that stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLACE_POS_TOL, PLACE_VEL_TOL, PLACE_YAW_TOL } from "../constants";
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
  type Vec3,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The pad, directly under the minimal crane's pivot, resting on the ground. */
const PAD: LoadPose = { x: 0, y: 2, z: 0, yaw: 0 };

/** Where the load waits before it is hung on the hook. */
const START: LoadPose = { x: 6, y: 2, z: 0, yaw: 0 };

/** Where it is set down: inside every tolerance, on none of the three figures. */
const DROP: LoadPose = { x: 0.3, y: 2, z: 0, yaw: 5 };

/** Moving as it is set down, inside `PLACE_VEL_TOL`. */
const DRIFT: Vec3 = { x: 0, y: 0, z: 0.3 };

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
 * Hang load `index` on the hook at `pose`, moving at `velocity`.
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
  velocity: Vec3,
): Promise<void> {
  const { pivot } = (await harness.snapshot()).run;
  await harness.debug.setBob(pose.x, pose.y, pose.z);
  await harness.debug.setBobVelocity(velocity.x, velocity.y, velocity.z);
  await harness.debug.setAxis("hoist", distance3(pivot, pose));
  await harness.debug.setAxis("grip", pose.yaw);
  await harness.debug.setLoadPhase(index, "attached");
  await harness.debug.setLoadPose(index, pose.x, pose.y, pose.z, pose.yaw);
}

it("sets a load down at exactly its target pose, not where it was let go", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, PAD);
  await poseTape(h, TAPE);
  await startRun(h);
  await hangOnHook(h, 0, DROP, DRIFT);

  const after = await runTicks(h, 1);
  await h.capture("placed", "The load set down on its pad");

  const load = after.run.loads[0];
  assertEqual(
    load?.phase,
    "placed",
    `a release ${distance3(DROP, PAD)} from the pad (PLACE_POS_TOL ` +
      `${PLACE_POS_TOL}), ${DROP.yaw} degrees round from its yaw ` +
      `(PLACE_YAW_TOL ${PLACE_YAW_TOL}) and moving at ${DRIFT.z} ` +
      `(PLACE_VEL_TOL ${PLACE_VEL_TOL}): all three hold (specs/rigging.md)`,
  );
  assertEqual(
    load?.pos.x,
    PAD.x,
    "the placed load's lift point on x: exactly its target position, not " +
      "where the hook let it go (specs/rigging.md)",
  );
  assertEqual(
    load?.pos.y,
    PAD.y,
    "the placed load's lift point on y (specs/rigging.md)",
  );
  assertEqual(
    load?.pos.z,
    PAD.z,
    "the placed load's lift point on z (specs/rigging.md)",
  );
  assertEqual(
    load?.yaw,
    PAD.yaw,
    "the placed load's yaw: exactly its target yaw (specs/rigging.md)",
  );
});
