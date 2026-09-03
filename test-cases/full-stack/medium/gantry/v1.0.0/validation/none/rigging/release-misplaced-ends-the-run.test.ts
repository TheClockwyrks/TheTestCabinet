// rigging/release-misplaced-ends-the-run — a release that fails a test ends the
// run.
//
// specs/rigging.md, Releasing: "If any test fails, the load is dropped and
// `lost`, and the run ends as `release-misplaced`." This point is the run's half
// of that sentence: the verdict the run carries away. What becomes of the load is
// its own point.
//
// THE POSITION TEST IS THE ONE MADE TO FAIL, and only it. The bob stands one unit
// from the pad — twice `PLACE_POS_TOL` (`0.5`), so no tolerance argument reaches
// it — at rest, which passes the speed test outright, with the grip on the pad's
// own yaw, which passes the yaw test outright. So the run ends because a test
// failed and for no other reason, and it ends on the release's own tick, which is
// what `run.tick` is read for.
//
// ONE LOAD, NO OBSTACLES, the smallest crane that stands: nothing else in the
// yard could reach a verdict of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLACE_POS_TOL } from "../constants";
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

/** Where it is set down: one unit off the pad, twice `PLACE_POS_TOL`. */
const DROP: LoadPose = { x: 1, y: 2, z: 0, yaw: 0 };

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

it("ends the run as release-misplaced on the failed release's own tick", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, PAD);
  await poseTape(h, TAPE);
  await startRun(h);
  await hangOnHook(h, 0, DROP);

  const after = await runTicks(h, 1);
  await h.capture("drop", "The yard on the misplaced release");

  assertEqual(
    after.run.phase,
    "failed",
    `a release ${distance3(DROP, PAD)} unit(s) from the pad, past ` +
      `PLACE_POS_TOL (${PLACE_POS_TOL}): the run ends (specs/rigging.md)`,
  );
  assertEqual(
    after.run.cause,
    "release-misplaced",
    "the cause the failed release ends the run with (specs/rigging.md)",
  );
});
