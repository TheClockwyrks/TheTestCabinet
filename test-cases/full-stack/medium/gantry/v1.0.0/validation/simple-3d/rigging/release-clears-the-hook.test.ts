// rigging/release-clears-the-hook — a placed load leaves the hook empty.
//
// specs/rigging.md, Releasing: "If all three hold, the load is `placed`: it
// leaves the hook, sits at exactly its target pose for the rest of the run, and
// the `placed` cue plays." Leaving the hook is a fact about the hook as much as
// about the load: `specs/state.md` reports what hangs there as `run.attached`,
// "the attached load's index, or null", and a load that has been set down is no
// longer hanging, so the reading is `null` from the release's own tick.
//
// THE LOAD'S OWN PHASE IS ANOTHER POINT'S. A build that marks the load `placed`
// and leaves the hook still pointing at it has left the hook full — the next
// `attach` would find no free hook and end the run (specs/rigging.md) — so what
// is read here is `run.attached` and nothing else.
//
// THE RELEASE IS POSED INSIDE EVERY TOLERANCE so the only thing that could stop
// it is the requirement itself: the bob stands exactly on the pad, at rest, with
// the grip on the pad's yaw, which passes the position, the yaw and the speed
// test outright.
//
// NOTHING ELSE STANDS IN THE YARD. The hook is what this is about, so the yard
// holds one load and no obstacle, and the crane is the smallest one that stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
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

it("reads no attachment from the tick a successful release executes on", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, START, PAD);
  await poseTape(h, TAPE);
  await startRun(h);
  await hangOnHook(h, 0, PAD);

  const after = await runTicks(h, 1);
  await h.capture("release", "The hook on the tick the load was set down");

  assertNull(
    after.run.attached,
    "what hangs on the hook on the release's own tick: a placed load leaves " +
      "the hook (specs/rigging.md)",
  );
});
