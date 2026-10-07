// rigging/release-yaw-difference-is-symmetric — short of the pad's yaw and past
// it are the same distance off.
//
// specs/rigging.md, Releasing, spells the consequence out: the wrapped difference
// "is never negative and never above `180`, so a load `2` degrees short of its
// target yaw and one `2` degrees past it are both `2` degrees off". The
// difference is a distance round the circle, not a signed one, so it does not
// matter which way the grip turned to get there.
//
// BOTH SIDES BELONG TO ONE VALIDATOR because they are one edge case exercised
// the same way: what is being decided is that the two readings agree, and a
// scenario that showed only one of them would decide nothing about symmetry. `2`
// degrees is well inside `PLACE_YAW_TOL` (`10`) on either side, so neither
// release is near the bound — where the bound falls is its own point.
//
// TWO LOADS, TWO PADS, TWO RELEASES, one run. The tape carries two release
// steps, and `specs/program.md` fixes that "two actions in a row occupy two ticks
// and never one", so each release lands on a tick of its own and the second is
// posed after the first has been judged. The pads stand three units apart, so
// neither release can be argued to have been judged against the other's.
//
// EVERY OTHER TEST IS SATISFIED IN BOTH: each bob stands exactly on its own pad,
// at rest, so the yaw is the only thing that can decide either verdict.

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

/** How far either side of its pad's yaw a load is turned. */
const OFF_BY = 2;

/** On the first pad, turned `OFF_BY` degrees short of the yaw it asks for. */
const SHORT: LoadPose = { ...PAD_A, yaw: PAD_A.yaw - OFF_BY };

/** On the second pad, turned `OFF_BY` degrees past the yaw it asks for. */
const PAST: LoadPose = { ...PAD_B, yaw: PAD_B.yaw + OFF_BY };

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

it("places a load 2 degrees short of its target yaw and one 2 degrees past it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);

  await h.debug.addLoad("crate", 40, PAD_A.x, PAD_A.y, PAD_A.z, PAD_A.yaw);
  await h.debug.setLoadTarget(0, PAD_A.x, PAD_A.y, PAD_A.z, PAD_A.yaw);
  await h.debug.addLoad("crate", 40, PAD_B.x, PAD_B.y, PAD_B.z, PAD_B.yaw);
  await h.debug.setLoadTarget(1, PAD_B.x, PAD_B.y, PAD_B.z, PAD_B.yaw);

  await poseTape(h, TAPE);
  await startRun(h);

  await hangOnHook(h, 0, SHORT);
  const first = await runTicks(h, 1);
  await h.capture("yaw", "The load 2 degrees off its pad");
  assertEqual(
    first.run.loads[0]?.phase,
    "placed",
    `a load ${OFF_BY} degrees short of its target yaw: the wrapped ` +
      `difference is ${OFF_BY}, inside PLACE_YAW_TOL (${PLACE_YAW_TOL}) ` +
      "(specs/rigging.md)",
  );

  await hangOnHook(h, 1, PAST);
  const second = await runTicks(h, 1);
  assertEqual(
    second.run.loads[1]?.phase,
    "placed",
    `a load ${OFF_BY} degrees PAST its target yaw: the wrapped difference is ` +
      `${OFF_BY} either way round (specs/rigging.md)`,
  );
});
