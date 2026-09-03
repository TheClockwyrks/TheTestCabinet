// rigging/release-judged-against-its-own-target — a load is judged against its
// own pad, never against the nearest one.
//
// specs/rigging.md, Releasing: "When it executes with a load attached, the
// load's pose is judged against its own target pose". Each load carries a target
// pose of its own (`specs/world.md`), so a yard with two loads has two pads, and
// setting one load down squarely on the other's pad satisfies nothing: the
// distance that is measured is the distance to its own.
//
// THE SECOND LOAD IS THE POINT, NOT A BYSTANDER. The requirement cannot be
// stated without another pad to land on, so the yard holds exactly two loads and
// nothing else: the one on the hook, whose pad stands six units away, and the one
// still waiting, whose pad is the one the hook is standing over.
//
// EVERY OTHER TEST IS SATISFIED, so the position test against the load's own
// target is the only thing that can decide the verdict: the bob is at rest, and
// the grip stands on the yaw both pads ask for. Six units is twelve times
// `PLACE_POS_TOL` (`0.5`), so no tolerance argument reaches it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLACE_POS_TOL } from "../constants";
import {
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

/** The hung load's own pad, six units from where it is set down. */
const OWN_PAD: LoadPose = { x: 6, y: 2, z: 0, yaw: 0 };

/** The other load's pad, directly under the pivot, where the hook stands. */
const OTHER_PAD: LoadPose = { x: 0, y: 2, z: 0, yaw: 0 };

/** Where the other load waits, clear of both pads. */
const OTHER_START: LoadPose = { x: -6, y: 2, z: 0, yaw: 0 };

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

it("misplaces a load set down exactly on another load's pad", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);

  // The two loads, in the order the site lists them: the one that goes on the
  // hook first, then the one whose pad it is about to land on.
  await h.debug.addLoad(
    "crate",
    40,
    OWN_PAD.x,
    OWN_PAD.y,
    OWN_PAD.z,
    OWN_PAD.yaw,
  );
  await h.debug.setLoadTarget(0, OWN_PAD.x, OWN_PAD.y, OWN_PAD.z, OWN_PAD.yaw);
  await h.debug.addLoad(
    "crate",
    40,
    OTHER_START.x,
    OTHER_START.y,
    OTHER_START.z,
    OTHER_START.yaw,
  );
  await h.debug.setLoadTarget(
    1,
    OTHER_PAD.x,
    OTHER_PAD.y,
    OTHER_PAD.z,
    OTHER_PAD.yaw,
  );

  await poseTape(h, TAPE);
  await startRun(h);
  await hangOnHook(h, 0, OTHER_PAD);

  const after = await runTicks(h, 1);
  await h.capture("pads", "The load set down on the other load's pad");

  assertEqual(
    after.run.cause,
    "release-misplaced",
    "the verdict of setting a load down on another load's pad: its own pad " +
      `stands ${distance3(OWN_PAD, OTHER_PAD)} units away, far past ` +
      `PLACE_POS_TOL (${PLACE_POS_TOL}), and the load's pose is judged ` +
      "against its own target pose (specs/rigging.md)",
  );
});
