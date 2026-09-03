// rigging/release-carries-the-bob-on — a release moves the bob not at all.
//
// specs/rigging.md, Releasing: of a successful release, "The bob's mass drops
// back to the hook's from this tick's pendulum step on, and its position and
// velocity carry on unchanged." A release therefore changes exactly one thing
// about the bob — what it weighs — and the pendulum tick above it reads no mass
// at all: its seven steps are written over the pivot, the cable length, `p` and
// `v`, and nothing else. So the swing a release happens in the middle of is the
// swing that would have carried on without it.
//
// THE CONTROL IS THE SAME RUN WITH THE RELEASE TAKEN OUT. A tape cannot simply
// lose a step — an empty tape refuses the start (`specs/program.md`) and a
// shorter tape would end the run a tick sooner — so the control replaces the
// release with a move step that commands the grip to the value it already holds.
// `specs/program.md` fixes what such a command does: "A command whose target is
// the axis's current value therefore has `s` of `0`: the axis neither brakes nor
// accelerates, it does not move, and step 3 finds it arrived, so the command is
// done on the tick it is issued." The two tapes therefore occupy the same ticks,
// leave every axis at the same value, and put the pivot on the same path; the
// only difference between the two runs is that one of them released the load and
// the other is still carrying it.
//
// BOTH TAPES END ON A GRIP TURN, which is what keeps the runs going long enough
// to watch. The grip is the one axis the rigging cannot feel: "Turning the grip
// applies no force to anything", and it moves neither the pivot nor the cable
// length, so ninety ticks of it are ninety ticks of undisturbed pendulum.
//
// THE BOB IS SET SWINGING RATHER THAN LEFT HANGING. A bob at rest below the
// pivot stays exactly where it is, and two runs agreeing about a bob that never
// moves would prove nothing. `0.5` units a second is inside `PLACE_VEL_TOL`
// (`0.6`), so the release still lands, and the swing it starts stays at or above
// the bottom of the arc — where the load's bottom face rests exactly on `y = 0`
// — so the load the control run keeps carrying never reaches through the ground.
//
// THE TWO PATHS ARE COMPARED EXACTLY. The pendulum's steps carry no mass term,
// so a build that honours them computes the same figures from the same inputs in
// both runs, down to the last bit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE, PLACE_VEL_TOL } from "../constants";
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
  type Vec3,
} from "../harness";

/** Site 1, First Lift: an empty yard, and room for the minimal crane. */
const SITE = 0;

/** The pad, directly under the minimal crane's pivot, resting on the ground. */
const PAD: LoadPose = { x: 0, y: 2, z: 0, yaw: 0 };

/** Where the load waits before it is hung on the hook. */
const START: LoadPose = { x: 6, y: 2, z: 0, yaw: 0 };

/** The crate the control run keeps carrying the whole way. */
const MASS = 40;

/** The swing the release happens in the middle of, inside `PLACE_VEL_TOL`. */
const SWING: Vec3 = { x: PLACE_VEL_TOL - 0.1, y: 0, z: 0 };

/** Ticks of pendulum watched on either side of the release. */
const SAMPLES = 90;

/** The step under test: the release, taken on the run's first tick. */
const RELEASE: TapeStepSpec = { kind: "action", action: "release" };

/** The control's stand-in: a grip command to where the grip already stands. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: PAD.yaw, rate: GRIP_MAX_RATE }],
};

/** What keeps both runs ticking: a turn of the grip, which the rigging cannot feel. */
const TURN: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 60, rate: 5 }],
};

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

/** Run one of the two tapes over the same crane and yard, sampling the bob. */
async function swing(harness: Harness, first: TapeStepSpec): Promise<string[]> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await standMinimalCrane(harness);
  await addOneLoad(harness, "crate", MASS, START, PAD);
  await poseTape(harness, [first, TURN]);
  await startRun(harness);
  await hangOnHook(harness, 0, PAD, SWING);

  const path: string[] = [];
  for (let tick = 0; tick < SAMPLES; tick += 1) {
    path.push(JSON.stringify((await runTicks(harness, 1)).run.bob));
  }
  return path;
}

it("leaves the bob's position and velocity exactly as the pendulum left them", async () => {
  const released = await swing(h, RELEASE);
  await h.capture("bob", "The bob's path across the release");

  const control = await createHarness();
  let carried: string[];
  try {
    carried = await swing(control, HOLD);
  } finally {
    await control.dispose();
  }

  for (const [index, sample] of released.entries()) {
    assertEqual(
      sample,
      carried[index],
      `the bob ${index + 1} tick(s) after the release, against the same run ` +
        "still carrying the load: a release changes the bob's mass and " +
        "nothing else about it, and the pendulum tick reads no mass " +
        "(specs/rigging.md)",
    );
  }
});
