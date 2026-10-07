// rigging/release-position-tolerance — where the position bound falls.
//
// specs/rigging.md, Releasing, gives the position test as "distance from lift
// point to target position at most `PLACE_POS_TOL` (`0.5`)". AT MOST: the bound
// itself places, and the first release beyond it does not. So the bound is
// decided from both sides in one scenario — a release exactly `0.5` from its pad,
// and a release `0.6` from its own — because a build that reads the bound as
// `less than` and a build that reads it as `1.0` are both wrong here and neither
// is visible from one side alone.
//
// TWO LOADS, TWO PADS, TWO RELEASES, one run. The tape carries two release
// steps, and `specs/program.md` fixes that "two actions in a row occupy two ticks
// and never one", so each release lands on a tick of its own and the second is
// posed after the first has been judged. The pads stand three units apart, so
// neither release can be argued to have been judged against the other's.
//
// EVERY OTHER TEST IS SATISFIED IN BOTH. Both releases are made at rest, with the
// grip on the pad's own yaw, so the position test is the only one that can decide
// either verdict. Both offsets are along `x` alone, so the distance from the lift
// point to the target is the offset exactly.

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

/** The first load's pad, directly under the pivot, resting on the ground. */
const PAD_A: LoadPose = { x: 0, y: 2, z: 0, yaw: 0 };

/** The second load's pad, three units away and clear of the first. */
const PAD_B: LoadPose = { x: 3, y: 2, z: 0, yaw: 0 };

/** Exactly `PLACE_POS_TOL` from the first pad: at most the bound, so placed. */
const AT_BOUND: LoadPose = { ...PAD_A, x: PAD_A.x + PLACE_POS_TOL };

/** Past the bound from the second pad, by a fifth of the bound again. */
const PAST_BOUND: LoadPose = { ...PAD_B, x: PAD_B.x + 0.6 };

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

it("places a release at exactly PLACE_POS_TOL and misplaces one beyond it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);

  await h.debug.addLoad("crate", 40, PAD_A.x, PAD_A.y, PAD_A.z, PAD_A.yaw);
  await h.debug.setLoadTarget(0, PAD_A.x, PAD_A.y, PAD_A.z, PAD_A.yaw);
  await h.debug.addLoad("crate", 40, PAD_B.x, PAD_B.y, PAD_B.z, PAD_B.yaw);
  await h.debug.setLoadTarget(1, PAD_B.x, PAD_B.y, PAD_B.z, PAD_B.yaw);

  await poseTape(h, TAPE);
  await startRun(h);

  await hangOnHook(h, 0, AT_BOUND);
  const first = await runTicks(h, 1);
  await h.capture("tolerance", "The release at exactly PLACE_POS_TOL");
  assertEqual(
    first.run.loads[0]?.phase,
    "placed",
    `a release exactly ${PLACE_POS_TOL} from its pad: the position test is ` +
      `"at most PLACE_POS_TOL (${PLACE_POS_TOL})" (specs/rigging.md)`,
  );

  await hangOnHook(h, 1, PAST_BOUND);
  const second = await runTicks(h, 1);
  assertEqual(
    second.run.cause,
    "release-misplaced",
    `a release ${distance3(PAST_BOUND, PAD_B).toFixed(1)} from its pad, past ` +
      `PLACE_POS_TOL (${PLACE_POS_TOL}) (specs/rigging.md)`,
  );
});
