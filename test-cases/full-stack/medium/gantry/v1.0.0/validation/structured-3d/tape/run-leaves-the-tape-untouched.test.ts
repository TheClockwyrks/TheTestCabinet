// tape/run-leaves-the-tape-untouched — a run neither consumes nor rewrites the
// tape.
//
// `specs/program.md` § Starting and ending a run: "Either way the structure, the
// tape, and the loads' starting poses are untouched: every run begins from the
// same authored state, and running is always repeatable." The run walks the tape
// with `run.stepIndex` (`specs/state.md`), and the tape itself is the player's
// document: every step stands as authored once the run has ended.
//
// THE TAPE IS READ BACK STEP FOR STEP AND COMMAND FOR COMMAND, against the
// snapshot's `program` taken before the run — the axis, the absolute target and
// the rate of every command, and the action of every action step. A build that
// shifted its steps as it took them, dropped the ones it had run, or wrote a
// live target back into a command parts from the reading here.
//
// THE RUN GOES THROUGH THE TAPE AND THEN FAILS PART WAY. The first step turns the
// arm and completes; the second commands the hoist below `HOIST_MIN` (`1`), which
// `specs/program.md` ends as `command-out-of-range` when the step starts; the
// third is never reached. So the tape is read back after a run that consumed some
// of it, was running when it stopped, and left a step untaken.
//
// THE TURN IS A SHORT ONE, because what this point is about is the document the
// run leaves behind rather than how far the arm got. A half-degree turn is a move
// the controller accelerates into and brakes out of exactly as it does a long one,
// and it completes in a sixth of the ticks a twenty-degree turn takes — so the
// run still walks into its second step, and the tape read back afterwards is the
// tape of a run that took a step and failed on the next.
//
// The screen is taken back to `build` with `setScreen`, which "shows a named
// screen and sets nothing else" (`specs/instrumentation.md`), so the reading is
// what the player would come back to.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN, SLEW_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The turn the first step makes: short, and a genuine accelerated move. */
const TURN = 0.5;

/** Three steps: one that runs, one that ends the run, and one never reached. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: TURN, rate: SLEW_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MIN - 1, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "attach" },
];

/** Ticks the sweep is given: half a degree of slew takes about sixteen. */
const CAP = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every step of the tape as authored once the run has ended", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const authored = (await h.snapshot()).program;
  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the run to end on its second step's unreachable target",
  );
  assertEqual(
    ended.run.cause,
    "command-out-of-range",
    "the cause this tape's second step ends the run with (specs/program.md)",
  );
  assertGreaterThan(
    ended.run.stepIndex,
    0,
    "the steps the run took before it ended, so the tape read back is one a " +
      "run has walked into",
  );

  await h.debug.setScreen("build");
  const after = (await h.snapshot()).program;

  await h.capture("state", "The tape the run left, back on the build screen");

  assertDeepEqual(
    after,
    authored,
    "the tape after the run: every step as authored, step for step and " +
      "command for command, since a run leaves the tape untouched " +
      "(specs/program.md)",
  );
});
