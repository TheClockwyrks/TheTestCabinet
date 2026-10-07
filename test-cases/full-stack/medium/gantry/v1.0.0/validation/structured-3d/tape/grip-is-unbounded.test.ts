// tape/grip-is-unbounded — the grip axis has no range, so a tape may turn the
// hook as far as it likes.
//
// `specs/program.md` § The axes gives the `grip` row a range of "unbounded", and
// the tape rule it is measured against in the same file: "A step whose command
// targets a value outside its axis's range at that moment ends the run as
// `command-out-of-range`." An unbounded axis has no such value, so a target of
// `540` — a turn and a half — is issued like any other and the axis drives to it.
//
// FIVE HUNDRED AND FORTY DEGREES, not ninety, because the reading has to separate
// an unbounded axis from one a build wrapped or clamped. A build that folded the
// grip into `[0, 360)` reports `180` where the specification asks for `540`; one
// that clamped it at a full turn reports `360`; one that judged it out of range
// fails the run. Each of the three is a different value in the same reading.
//
// THE AXIS IS POSED AT `START` AND EARNS THE LAST TWENTY DEGREES. The run's own
// posture puts the grip at `0` (`specs/program.md`), and turning it the whole way
// round from there is seven hundred and twenty ticks of driving that decide
// nothing this reading does not already get from the last twenty: `setAxis`
// "takes any value the axis can hold" and leaves it "stopped with no live
// command" (`specs/instrumentation.md`), so the pose is a precondition and the
// step is still issued, still judged against the axis's range, and still driven
// to its target by the controller `specs/program.md` fixes. The three builds this
// point separates are separated exactly as before: one that folds the grip into
// `[0, 360)` arrives at `180` whether it folded the pose or the target, one that
// clamps at a full turn arrives at `360`, and one that judges `540` out of range
// ends the run on the tick that takes the step.
//
// THE HOOK TURNS ALONE. The yard is emptied, so no load is attached and the grip
// "turns the bare hook, visibly and to no other effect" (`specs/rigging.md`):
// nothing about the swing, the tension or the solve can end the run while the
// scenario is waiting, and the verdict rests on the axis.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull } from "../assert";
import { GRIP_ACCEL, GRIP_MAX_RATE, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A turn and a half: past a full turn, and not a wrap of anything smaller. */
const TARGET = 540;

/** Where the grip is posed before the step is taken: twenty degrees short. */
const START = 520;

/** The move the tape carries. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: TARGET, rate: GRIP_MAX_RATE }],
  },
];

/**
 * The ticks the posed move takes, driven in one crossing before anything is
 * read.
 *
 * `TARGET - START` is twenty degrees. `GRIP_ACCEL` (`90` deg/s²) needs
 * `GRIP_MAX_RATE² / (2 * GRIP_ACCEL)` — `11.25` degrees — to reach the commanded
 * rate and as much again to stop, so twenty degrees is the triangular case: the
 * axis accelerates over half of it and brakes over the other half, which is
 * `2 * sqrt((TARGET - START) / (2 * GRIP_ACCEL))` seconds of run clock. Rounded
 * up and given a couple of ticks of slack, and the run is still running when it
 * ends, because the step completes at the top of the tick after the axis arrives.
 */
const DRIVE =
  Math.ceil(2 * Math.sqrt((TARGET - START) / (2 * GRIP_ACCEL)) * TICK_HZ) + 5;

/**
 * How much longer a build is given to arrive, sampled a tick at a time.
 *
 * A conformant build has arrived before this is reached, so the sweep costs
 * nothing; a build that drives the grip more slowly than the controller says
 * still reaches its target and is graded on where it stopped rather than on how
 * long it took, and one that never arrives fails here by name.
 */
const SLACK = 20;

/** The controller sets the value to the target exactly on arrival. */
const TOL = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drives the grip to a target past a full turn", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  // The precondition: the grip stands past a full turn already, and stands there
  // stopped, with the step still to be taken. Nothing has ticked at `startRun`
  // (`specs/state.md`), so no command is live for this to clear and the tick that
  // follows is the one that takes the move and judges its target.
  await h.debug.setAxis("grip", START);

  const done = (s: GantrySnapshot): boolean =>
    s.run.phase !== "running" ||
    Math.abs(s.run.axes.grip.value - TARGET) <= TOL;

  const driven = await runTicks(h, DRIVE);
  const arrived = done(driven)
    ? driven
    : await runUntil(
        h,
        done,
        SLACK,
        `the grip to reach ${TARGET}, or the run to end trying`,
      );
  await h.capture("state", "The driven state this point decides");

  assertNull(
    arrived.run.cause,
    `the failure cause of a run whose grip was told to turn to ${TARGET}: ` +
      "the grip's range is unbounded (specs/program.md)",
  );
  assertClose(
    arrived.run.axes.grip.value,
    TARGET,
    TOL,
    "the grip's value where its command stopped (specs/program.md)",
  );
  assertEqual(
    arrived.run.axes.grip.rate,
    0,
    "the grip's rate once it arrived (specs/program.md)",
  );
});
