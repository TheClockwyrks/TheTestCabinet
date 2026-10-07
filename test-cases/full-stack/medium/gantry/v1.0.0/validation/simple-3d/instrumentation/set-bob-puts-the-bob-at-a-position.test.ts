// instrumentation/set-bob-puts-the-bob-at-a-position — the pose puts the
// pendulum bob at the world position it is handed.
//
// `specs/instrumentation.md` § The run in progress states the operation in one
// line — "`setBob(x, y, z)` | Puts the pendulum bob at a world position" — and
// then says what it does NOT do: "`setBob` puts the bob where it is asked for,
// so a caller that wants a bob the cable can hold sets the hoist axis to the
// distance it left between the pivot and the bob. The pendulum's own constraint
// runs on the next tick either way." So the position asked for is the position
// the snapshot reports AT THE CALL, whether or not the cable could hold it, and
// the reading is taken before a tick has had the chance to pull the bob back
// onto the cable.
//
// `run.bob.pos` is where the snapshot reports it (`specs/instrumentation.md` §
// Snapshot shape), and the position posed is well off the run-start bob — which
// stands "at rest the hoist length below the pivot" (`specs/state.md`) — so a
// build that ignored the pose could not pass by leaving the bob where it was.
//
// THE WORLD IS EMPTY BUT FOR THE CRANE AND THE TAPE THAT MAKES A RUN. This
// decides one pose and nothing about the yard, so the loads and the obstacles
// are cleared and the crane is the minimal one: a load or an obstacle standing
// anywhere would only add a rule this requirement is not about.

import { afterEach, beforeEach, it } from "vitest";
import { assertVec3Near } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/**
 * A tape that keeps a run in progress and asks nothing of the structure: "With
 * no load attached the grip turns the bare hook, visibly and to no other
 * effect", and "Turning the grip applies no force to anything"
 * (`specs/rigging.md`).
 */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Well off the run-start bob, and off the cable the hoist leaves. */
const WHERE = { x: 3, y: 8, z: -2 };

/** The pose answers the position it was handed, exactly. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the bob at the world position it is handed", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  // One frame, so the still below is the run screen rather than whatever was
  // drawn last. It is taken before the pose, so the reading the check makes is
  // the pose's own and nothing the tick did.
  await h.advance(1);

  await h.debug.setBob(WHERE.x, WHERE.y, WHERE.z);
  const { run } = await h.snapshot();

  await h.advance(1);
  await h.capture("bob", "The bob posed away from the cable");

  assertVec3Near(
    run.bob.pos,
    WHERE,
    TOLERANCE,
    "run.bob.pos after setBob (specs/instrumentation.md)",
  );
});
