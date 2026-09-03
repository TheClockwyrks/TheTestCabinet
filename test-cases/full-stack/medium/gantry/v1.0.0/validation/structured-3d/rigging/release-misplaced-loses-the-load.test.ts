// rigging/release-misplaced-loses-the-load — a release that fails a test loses
// the load.
//
// specs/rigging.md, Releasing: "If any test fails, the load is dropped and
// `lost`, and the run ends as `release-misplaced`." This point is the load's half
// of that sentence — the load is gone, and the hook that was holding it is empty
// — where the run's verdict is its own point. `specs/world.md` fixes what the
// phase means: a load is "`lost` if it is dropped or destroyed".
//
// A DROPPED LOAD IS NOT A PLACED ONE AND NOT AN ATTACHED ONE. A build that
// leaves the load hanging, or marks it placed on the pad it missed, has kept
// something the specification threw away, and the run's own report of what hangs
// on the hook — `run.attached`, "the attached load's index, or null"
// (`specs/state.md`) — is the other side of the same reading.
//
// THE POSITION TEST IS THE ONE MADE TO FAIL, and only it: the bob stands one unit
// from the pad, twice `PLACE_POS_TOL` (`0.5`), at rest, with the grip on the
// pad's own yaw. So the load is lost because a test failed and for no other
// reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { PLACE_POS_TOL } from "../constants";
import {
  addOneLoad,
  createHarness,
  distance3,
  emptyYard,
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

it("drops the load as lost and leaves the hook holding nothing", async () => {
  await openSite(h, SITE);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, PAD);
  await poseTape(h, TAPE);
  await startRun(h);
  await hangOnHook(h, 0, DROP);

  const after = await runTicks(h, 1);
  await h.capture("lost", "The lost load after the failed release");

  assertEqual(
    after.run.loads[0]?.phase,
    "lost",
    `the phase of a load released ${distance3(DROP, PAD)} unit(s) from its ` +
      `pad, past PLACE_POS_TOL (${PLACE_POS_TOL}): it is dropped and lost ` +
      "(specs/rigging.md)",
  );
  assertNull(
    after.run.attached,
    "what hangs on the hook once the release dropped the load " +
      "(specs/rigging.md)",
  );
});
