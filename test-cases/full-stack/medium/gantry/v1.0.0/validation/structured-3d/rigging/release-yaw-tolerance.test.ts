// rigging/release-yaw-tolerance — where the yaw bound falls.
//
// specs/rigging.md, Releasing, gives the yaw test as "the wrapped difference
// between load yaw and target yaw at most `PLACE_YAW_TOL` (`10`) degrees". AT
// MOST: a load exactly `10` degrees round from the yaw its pad asks for still
// sets down, and the first degree beyond that does not. So the bound is decided
// from both sides in one scenario — a build that reads it as `less than` and a
// build that reads it as `45` are both wrong here, and neither is visible from
// one side alone.
//
// TWO LOADS, TWO PADS, TWO RELEASES, one run. The tape carries two release
// steps, and `specs/program.md` fixes that "two actions in a row occupy two ticks
// and never one", so each release lands on a tick of its own and the second is
// posed after the first has been judged. The pads stand three units apart, so
// neither release can be argued to have been judged against the other's.
//
// EVERY OTHER TEST IS SATISFIED IN BOTH: each bob stands exactly on its own pad,
// at rest, so the yaw test is the only one that can decide either verdict. Both
// offsets are well under a half turn, so each is the shorter way round the circle
// as it is written and the wrapping has nothing to do here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLACE_YAW_TOL } from "../constants";
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

/** Exactly `PLACE_YAW_TOL` round from the first pad: at most the bound. */
const AT_BOUND: LoadPose = { ...PAD_A, yaw: PAD_A.yaw + PLACE_YAW_TOL };

/** One degree past the bound from the second pad. */
const PAST_BOUND: LoadPose = { ...PAD_B, yaw: PAD_B.yaw + PLACE_YAW_TOL + 1 };

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

it("places a release at exactly PLACE_YAW_TOL and misplaces one beyond it", async () => {
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
  await h.capture("yaw-tolerance", "The release at exactly PLACE_YAW_TOL");
  assertEqual(
    first.run.loads[0]?.phase,
    "placed",
    `a release exactly ${PLACE_YAW_TOL} degrees round from its pad's yaw: ` +
      `the yaw test is "at most PLACE_YAW_TOL (${PLACE_YAW_TOL}) degrees" ` +
      "(specs/rigging.md)",
  );

  await hangOnHook(h, 1, PAST_BOUND);
  const second = await runTicks(h, 1);
  assertEqual(
    second.run.cause,
    "release-misplaced",
    `a release ${PLACE_YAW_TOL + 1} degrees round from its pad's yaw, past ` +
      `PLACE_YAW_TOL (${PLACE_YAW_TOL}) (specs/rigging.md)`,
  );
});
