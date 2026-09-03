// rigging/release-speed-tolerance — where the speed bound falls.
//
// specs/rigging.md, Releasing, gives the speed test as "the bob's speed at most
// `PLACE_VEL_TOL` (`0.6`)". AT MOST: a bob moving at exactly `0.6` still sets its
// load down, and the first release above that does not. So the bound is decided
// from both sides in one scenario — a build that reads it as `less than` and a
// build that reads it as `1.0` are both wrong here, and neither is visible from
// one side alone.
//
// THE SPEED IS THE BOB'S, not the load's and not a component of it. Both releases
// are posed with the bob moving along `x` alone, so its speed is the figure
// posed, exactly.
//
// TWO LOADS, TWO PADS, TWO RELEASES, one run. The tape carries two release
// steps, and `specs/program.md` fixes that "two actions in a row occupy two ticks
// and never one", so each release lands on a tick of its own and the second is
// posed after the first has been judged.
//
// EVERY OTHER TEST IS SATISFIED IN BOTH: each bob stands exactly on its own pad
// with the grip on that pad's yaw, so the speed test is the only one that can
// decide either verdict.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLACE_VEL_TOL } from "../constants";
import {
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
  type Vec3,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The first load's pad, directly under the pivot, resting on the ground. */
const PAD_A: LoadPose = { x: 0, y: 2, z: 0, yaw: 0 };

/** The second load's pad, three units away and clear of the first. */
const PAD_B: LoadPose = { x: 3, y: 2, z: 0, yaw: 0 };

/** Exactly `PLACE_VEL_TOL`: at most the bound, so placed. */
const AT_BOUND: Vec3 = { x: PLACE_VEL_TOL, y: 0, z: 0 };

/** Past the bound, by a sixth of the bound again. */
const PAST_BOUND: Vec3 = { x: 0.7, y: 0, z: 0 };

/** The tape: two releases, one to a tick. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "release" },
  { kind: "action", action: "release" },
];

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

it("places a release at exactly PLACE_VEL_TOL and misplaces one above it", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);

  await h.debug.addLoad("crate", 40, PAD_A.x, PAD_A.y, PAD_A.z, PAD_A.yaw);
  await h.debug.setLoadTarget(0, PAD_A.x, PAD_A.y, PAD_A.z, PAD_A.yaw);
  await h.debug.addLoad("crate", 40, PAD_B.x, PAD_B.y, PAD_B.z, PAD_B.yaw);
  await h.debug.setLoadTarget(1, PAD_B.x, PAD_B.y, PAD_B.z, PAD_B.yaw);

  await poseTape(h, TAPE);
  await startRun(h);

  await hangOnHook(h, 0, PAD_A, AT_BOUND);
  const first = await runTicks(h, 1);
  await h.capture("speed", "The release at exactly PLACE_VEL_TOL");
  assertEqual(
    first.run.loads[0]?.phase,
    "placed",
    `a release with the bob moving at exactly ${PLACE_VEL_TOL}: the speed ` +
      `test is "the bob's speed at most PLACE_VEL_TOL (${PLACE_VEL_TOL})" ` +
      "(specs/rigging.md)",
  );

  await hangOnHook(h, 1, PAD_B, PAST_BOUND);
  const second = await runTicks(h, 1);
  assertEqual(
    second.run.cause,
    "release-misplaced",
    `a release with the bob moving at ${PAST_BOUND.x}, above PLACE_VEL_TOL ` +
      `(${PLACE_VEL_TOL}) (specs/rigging.md)`,
  );
});
