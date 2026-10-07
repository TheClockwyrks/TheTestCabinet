// instrumentation/set-bob-velocity-sets-the-velocity — the pose sets the bob's
// velocity to the vector it is handed.
//
// `specs/instrumentation.md` § The run in progress: "`setBobVelocity(vx, vy,
// vz)` | Sets the bob's velocity", and of the six run poses, "Each sets what it
// names and leaves the rest of the run as it stands". The snapshot reports it
// under `run.bob.vel` (§ Snapshot shape), so the pose is decided by setting a
// velocity and reading it back, at the call: the pendulum tick — gravity, the
// constraint, and the damping `specs/rigging.md` fixes — is what the NEXT tick
// does with it, and asserting after a tick would grade that instead.
//
// A run starts with the bob "at rest ... with zero velocity" (`specs/state.md`),
// so a posed velocity with a nonzero component on two axes and zero on the third
// separates a build that took the pose from one that left the bob at rest and
// from one that dropped a component.
//
// THE WORLD IS EMPTY BUT FOR THE CRANE AND THE TAPE THAT MAKES A RUN, because
// this decides one pose and nothing about the yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Nonzero on two axes, zero on the third, and nothing like rest. */
const VELOCITY = { x: 1, y: 0, z: -2 };

/** The pose answers the vector it was handed, exactly. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the bob's velocity to the vector it is handed", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  // One frame, so the still below is the run screen rather than whatever was
  // drawn last, and taken before the pose so the reading is the pose's own.
  await h.advance(1);

  await h.debug.setBobVelocity(VELOCITY.x, VELOCITY.y, VELOCITY.z);
  const { run } = await h.snapshot();

  await h.advance(1);
  await h.capture("velocity", "The bob one tick after a posed velocity");

  assertVec3Near(
    run.bob.vel,
    VELOCITY,
    TOLERANCE,
    "run.bob.vel after setBobVelocity (specs/instrumentation.md)",
  );
});
