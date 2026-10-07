// audio/placed-cue — the placed cue sounds on the tick a load is set down.
//
// specs/ui.md § Audio: "`placed` | a load is set down on its pad". A load is set
// down by the `release` action, and only when all three of the set-down tests
// hold: specs/rigging.md, "If all three hold, the load is `placed`: it leaves the
// hook, sits at exactly its target pose for the rest of the run, and the `placed`
// cue plays."
//
// THE RELEASE IS EARNED AND EVERYTHING BEFORE IT IS POSED. The requirement is
// about the tick a set-down happens on, so the load is hung on the hook through
// `setLoadPhase`, which specs/instrumentation.md says "hangs that load on the
// hook exactly as a successful `attach` leaves it", and the tape carries the
// `release` step alone. Nothing here drives a hoist move or an `attach` step to
// get there: those are other validators' requirements, and a build that missed
// either of them would otherwise fail this cue's point as well.
//
// THE RELEASE IS INSIDE EVERY TOLERANCE BY A WIDE MARGIN, and none of it is
// posed. With the minimal crane the pivot is the track origin `(0, 4, 0)` and a
// run starts with the cable at `HOIST_START`, so the bare hook hangs at rest at
// `(0, 2, 0)` — which is the crate's own pose and its pad both. The `release`
// step is therefore judged at a position error of zero, a yaw error of zero (the
// grip stands at the pad's own yaw) and a speed of zero, all far inside
// `PLACE_POS_TOL`, `PLACE_YAW_TOL` and `PLACE_VEL_TOL`. So the tick under test is
// a set-down that every conforming build agrees is one, and the game decides it:
// the pose stops at the hook, and the release is the run's own work.
//
// The cue is read off the release tick alone: the queue is drained on the tick
// before it, and the tick after it is the one that ends the run
// (specs/program.md), which sounds `complete` and is no part of this.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { HOIST_START } from "../constants";
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

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the bare hook hangs at rest, which is the crate's pose and its pad. */
const PAD = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** The tape: the release step alone, so the run's first tick is the set-down. */
const TAPE: readonly TapeStepSpec[] = [{ kind: "action", action: "release" }];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the placed cue on the tick a load is set down on its pad", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, PAD, PAD);
  await poseTape(h, TAPE);

  const started = await startRun(h);

  // The load on the hook, at rest, square to the grip: the precondition a
  // successful `attach` leaves, posed rather than driven to. The hoist is set to
  // the distance the pose left between the pivot and the bob, so the cable holds
  // it there (specs/instrumentation.md).
  await h.debug.setBob(PAD.x, PAD.y, PAD.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.debug.setAxis("hoist", distance3(started.run.pivot, PAD));
  await h.debug.setAxis("grip", PAD.yaw);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setLoadPose(0, PAD.x, PAD.y, PAD.z, PAD.yaw);
  await h.cues();

  const released = await runTicks(h, 1);
  const played = await h.cues();

  await h.capture("pad", "The load set down on its pad");

  assertEqual(
    released.run.loads[0]?.phase,
    "placed",
    "the load the release set down (specs/rigging.md)",
  );
  assertContains(
    played,
    "placed",
    "the cue a load being set down on its pad plays (specs/ui.md)",
  );
});
