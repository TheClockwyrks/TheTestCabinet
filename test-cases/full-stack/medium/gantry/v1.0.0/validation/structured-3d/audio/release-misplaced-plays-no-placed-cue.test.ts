// audio/release-misplaced-plays-no-placed-cue — a release outside the tolerances
// is silent.
//
// specs/ui.md § Audio binds `placed` to "a load is set down on its pad", and
// specs/rigging.md § Releasing says which releases are not that: the load's pose
// is judged against its target on position, yaw and speed, and "If any test
// fails, the load is dropped and `lost`, and the run ends as
// `release-misplaced`." A dropped load was never set down, so there is no event
// for the cue to play on — the sound of weight settling onto a pad is a lie over
// a load that fell, and the run is over.
//
// THE POSITION TEST IS THE ONE MADE TO FAIL, and only it. The load hangs one unit
// from its pad — twice `PLACE_POS_TOL` (`0.5`), so no reading of the tolerance
// reaches it — at rest, which passes the speed test outright, with the grip on the
// pad's own yaw, which passes the yaw test outright. So the release fails for one
// stated reason and the cue's silence is read against that.
//
// THE LOAD IS HUNG THROUGH THE SURFACE rather than through an `attach` step:
// specs/instrumentation.md has `setLoadPhase` to `"attached"` hang the load "on
// the hook exactly as a successful `attach` leaves it, without the candidate
// search", so the scenario reaches the release without any part of the attaching
// rules standing in the way. The bob is put where the load is asked to hang, the
// hoist axis set to the distance that leaves between the pivot and the bob so the
// cable holds it, and the grip set to the load's yaw, which is what an attach
// leaves ("the grip's axis value is set to the load's current yaw").
//
// THE `run-start` CUE IS DRAINED FIRST, so the read holds the release's own tick
// and nothing else; ONE LOAD AND NO OBSTACLES stand, so nothing else in the yard
// could reach a verdict or a cue of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
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

/** The pad, on the ground under the minimal crane's pivot. */
const PAD: LoadPose = { x: 0, y: 2, z: 0, yaw: 0 };

/** Where the load waits before it is hung on the hook. */
const START: LoadPose = { x: 6, y: 2, z: 0, yaw: 0 };

/** Where it is released: one unit off the pad, twice `PLACE_POS_TOL`. */
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

it("plays no placed cue on the tick a release fails its tolerances", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, PAD);
  await poseTape(h, TAPE);
  await startRun(h);

  // Hang the load where it will be released from: the bob's position is the
  // attached load's lift point, the cable holds it at the hoist axis's length,
  // and the grip carries the load's yaw (specs/rigging.md).
  const { pivot } = (await h.snapshot()).run;
  await h.debug.setBob(DROP.x, DROP.y, DROP.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.debug.setAxis("hoist", distance3(pivot, DROP));
  await h.debug.setAxis("grip", DROP.yaw);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setLoadPose(0, DROP.x, DROP.y, DROP.z, DROP.yaw);
  await h.cues();

  const dropped = await runTicks(h, 1);
  const onRelease = await h.cues();
  await h.capture("misplaced", "The tick the load was dropped");

  assertEqual(
    dropped.run.cause,
    "release-misplaced",
    `the cause a release ${distance3(DROP, PAD)} unit(s) from the pad ends ` +
      `the run with, past PLACE_POS_TOL (${PLACE_POS_TOL}) ` +
      "(specs/rigging.md § Releasing)",
  );
  assertTrue(
    !onRelease.includes("placed"),
    "the `placed` cue on the tick a release failed its position test: the " +
      'cue follows "a load is set down on its pad" (specs/ui.md § Audio), ' +
      "and this load was dropped and lost rather than placed. The tick " +
      `sounded ${JSON.stringify(onRelease)}`,
  );
});
