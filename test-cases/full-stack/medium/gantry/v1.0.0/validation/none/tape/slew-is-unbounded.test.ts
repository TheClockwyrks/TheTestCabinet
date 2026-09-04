// tape/slew-is-unbounded — the slew angle is a plain number, so a tape may wind
// the arm past a full turn.
//
// `specs/program.md` § The axes gives the `slew` row a range of "unbounded" and
// says so again in words: "The slew angle is a plain number rather than a wrapped
// one, so `360` is a full turn past `0` and a tape may wind the arm around as
// often as it likes." The tape rule it is measured against is in the same file: a
// step "whose command targets a value outside its axis's range at that moment ends
// the run as `command-out-of-range`", and an unbounded axis has no such value.
//
// TWO FULL TURNS, because the reading has to separate a plain number from the
// three ways a build might spoil it. A build that wrapped the angle into
// `[0, 360)` reports `0` where the specification asks for `720`; one that clamped
// at a turn reports `360`; one that judged the target out of range fails the run.
//
// THE SECOND TURN IS POSED AND THE LAST TWENTY DEGREES ARE DRIVEN, because the
// point is where an unbounded axis can stand and stop, not how long it takes to
// get there. `specs/instrumentation.md`: "`setAxis` takes any value the axis can
// hold. The ranges in `specs/program.md` are what a step's target is judged
// against when the step starts, not a bound on the axis itself." So the run
// starts, the slew is posed at `710` — a full turn and 350 degrees, a value only a
// plain number holds — and the tape's own step is taken on the run's FIRST TICK
// (`specs/program.md` § The tick pipeline: "If no step is live, this tick takes
// the next one ... a move step issues its commands to their axes"), which is the
// moment the target is judged and the moment the controller takes over. The pose
// is a precondition and nothing more: the range judgement, the ten degrees of
// travel and the arrival at `720` are all the run's own work.
//
// Each spoiler still shows. A build that wraps the angle answers the pose with
// `350` and never reads `720` back. A build that clamps at a turn answers it with
// `360`, never arrives, and never ends its run. A build that judges `720` out of
// range ends the run on its first tick with a cause.
//
// THE YARD IS EMPTY AND THE CRANE IS THE MINIMAL ONE, so nothing but the arm's own
// weight turns: no load to swing into the ground, no obstacle to sweep into, and
// the whole verdict rests on where the axis stops.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Two full turns: past a wrap, past a clamp at one turn. */
const TARGET = 720;

/**
 * Where the slew is posed before the tape's step is taken: one full turn and 350
 * degrees, which neither a wrapped angle nor an angle clamped at a turn can hold,
 * and which leaves the run ten degrees of its own to drive.
 */
const START = 710;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
  },
];

/**
 * The move driven in one call, because nothing on the way is read.
 *
 * Ten degrees never reaches `SLEW_MAX_RATE`: the controller ramps up over five
 * degrees and brakes straight back down over five at `SLEW_ACCEL`,
 * `2 * sqrt(2 * 5 / 30)` — about `1.15` seconds of run clock, so seventy-five
 * ticks covers the whole of it. Driving past the end of a run costs nothing and
 * reads nothing, so this is a ceiling rather than a count the check depends on.
 */
const DRIVE = 75;

/**
 * The tail polled a tick at a time afterwards, which is where the run's own end is
 * caught: the tape holds one step, so the run ends on the first tick that finds it
 * complete with none left to take (`specs/program.md` § The tick pipeline). A
 * build whose slew never arrives never ends its run, and fails on this cap.
 */
const TAIL = 60;

/** The controller sets the value to the target exactly on arrival. */
const TOL = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("winds the slew to a target two full turns past its start", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  // The run stands at tick `0` with no step taken and no command live, so posing
  // the axis here leaves the tape's own step to issue its command on the first
  // tick, against the value posed.
  await h.debug.setAxis("slew", START);

  await runTicks(h, DRIVE);

  // THE END OF THE RUN IS THE STOP, not a distance test on the axis. The
  // controller sets the value to the target exactly on the tick it arrives, and a
  // predicate reading `|value - TARGET| <= TOL` would stop on the tick BEFORE
  // that one, where the advance has landed within float dust of the target but the
  // controller's arrival step has not fired — the value is not yet `TARGET` and
  // the rate is not yet `0`. That reads an intermediate state of the controller
  // rather than the arrival this point is about.
  const arrived = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    TAIL,
    `the run to end, which it does once the slew reaches ${TARGET}`,
  );
  await h.capture("state", "The driven state this point decides");

  assertNull(
    arrived.run.cause,
    `the failure cause of a run whose slew was told to turn to ${TARGET}: ` +
      "the slew's range is unbounded (specs/program.md)",
  );
  assertClose(
    arrived.run.axes.slew.value,
    TARGET,
    TOL,
    "the slew's value where its command stopped (specs/program.md)",
  );
  assertEqual(
    arrived.run.axes.slew.rate,
    0,
    "the slew's rate once it arrived (specs/program.md)",
  );
});
