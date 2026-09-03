// rigging/release-drops-the-bob-mass — the bob weighs the hook alone from the
// release's own tick.
//
// specs/rigging.md, Releasing: "The bob's mass drops back to the hook's from
// this tick's pendulum step on". The tick the release executes on therefore
// carries the bare hook through every stage below the tape, and a build that
// keeps the load's mass for one more tick is loading the crane with something
// that is no longer hanging on it.
//
// THE CABLE IS WHAT READS THE MASS BACK. specs/rigging.md gives the tension as
// `T = m * (a - g)` with `m` the bob's mass, computed in the same rigging stage
// as the pendulum step and immediately after it (`specs/program.md`), and "A tick
// on which `|T|` exceeds `HOIST_CABLE_CAP` (`3000`) snaps the cable and ends the
// run as `cable-snap`". So the release tick's own mass is legible as a closed
// outcome, with no solver arithmetic to re-do: pick a load heavy enough that the
// hook plus the load would snap the cable and the hook alone comes nowhere near.
//
// THE FIGURES. The bob is posed at rest and the release tick is the run's first,
// where "the acceleration is zero, whatever velocity the steps above leave", so
// `|T|` is `m * GRAVITY` exactly. With the bare hook that is
// `HOOK_MASS * GRAVITY` = `50`, a sixtieth of the cap. With the load still on it
// that is `(HOOK_MASS + 400) * GRAVITY` = `4050`, comfortably past the cap of
// `3000`, so a build that drops the mass a tick late snaps the cable on this very
// tick and the run ends. The load never loads the structure either way: the
// release executes at the top of the tick, three stages before the solves.
//
// THE RELEASE IS POSED INSIDE EVERY TOLERANCE — the bob exactly on the pad, at
// rest, the grip on the pad's yaw — because the mass only drops when the release
// succeeds, and this point is about the tick it drops on.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import { GRAVITY, HOIST_CABLE_CAP, HOOK_MASS } from "../constants";
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

/**
 * A crate heavy enough that the hook plus the crate would snap the cable.
 *
 * `(HOOK_MASS + MASS) * GRAVITY` is `4050`, past `HOIST_CABLE_CAP` (`3000`);
 * `HOOK_MASS * GRAVITY` is `50`, nowhere near it.
 */
const MASS = 400;

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

it("carries only the hook's weight in the cable on the release's own tick", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", MASS, START, PAD);
  await poseTape(h, TAPE);
  await startRun(h);
  await hangOnHook(h, 0, PAD);

  const after = await runTicks(h, 1);
  await h.capture(
    "release",
    "The release tick, with the cable holding the hook alone",
  );

  assertNull(
    after.run.cause,
    "the cause the release tick ended the run with: the bob's mass is back " +
      `at HOOK_MASS (${HOOK_MASS}) from this tick's pendulum step on, so the ` +
      `cable carries ${HOOK_MASS * GRAVITY} against HOIST_CABLE_CAP ` +
      `(${HOIST_CABLE_CAP}), where a bob still weighing the load carries ` +
      `${(HOOK_MASS + MASS) * GRAVITY} and snaps (specs/rigging.md)`,
  );
});
