// tape/move-step-completes-on-the-following-tick — a move step is found complete
// at the top of the tick AFTER its axes arrive.
//
// `specs/program.md` § The tick pipeline: "A move step's axes arrive during a
// tick's axis motion, and the step is found complete at the top of the tick after
// that, which is the tick that takes the step following it." The arrival happens
// at stage 2, below the stage that reads it, so the tick that arrives is still
// running its own step and the tick after it moves the tape on.
//
// THE ARRIVAL IS FOUND RATHER THAN COUNTED. The check sweeps until the hoist's
// live command is gone, which `specs/program.md` § Axis motion says is exactly
// the tick the axis arrives on — "set `x = T`, `v = 0`, and the command is done"
// — so the reading needs no arithmetic about how many ticks a one-unit move
// takes, and a build whose controller is a tick out elsewhere is graded there
// rather than here.
//
// TWO STEPS, AND THE SECOND IS SLOW. `run.stepIndex` is what moves, so the tape
// must have somewhere to move to: the second step is a slew move of forty-five
// degrees, which outlives the reading by seconds, so the tick after the arrival
// is a tick that TAKES a step rather than one that finds the tape empty.
//
// The yard is emptied and the crane is the minimal one: the requirement is about
// when the tape stage reads an arrival, and nothing about the world it turns in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
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

/** Where the first step drives the hoist: one unit up from the run-start value. */
const HOIST_TARGET = HOIST_START + 1;

/** The tape: a hoist move that arrives, then a slew move that outlives it. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_TARGET, rate: HOIST_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "slew", target: 45, rate: SLEW_MAX_RATE }],
  },
];

/** Ticks the sweep is given: the hoist arrives in about twenty-six. */
const CAP = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the step index over the arriving tick and moves it on the next", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const arrived = await runUntil(
    h,
    (s) => s.run.tick >= 1 && s.run.axes.hoist.command === null,
    CAP,
    "the first step's hoist command to arrive",
  );
  const after = await runTicks(h, 1);

  await h.capture("state", "The tape one tick after the first step arrived");

  assertNull(
    arrived.run.axes.hoist.command,
    "the hoist's live command on the tick it arrived (specs/program.md)",
  );
  assertEqual(
    arrived.run.axes.hoist.value,
    HOIST_TARGET,
    "the hoist's value on the tick it arrived, set exactly on its target",
  );
  assertEqual(
    arrived.run.stepIndex,
    0,
    "run.stepIndex on the tick the step's axes arrived: the arrival happens " +
      "at the axis-motion stage, below the stage that reads it, so the step " +
      "is still the one the run is on (specs/program.md)",
  );
  assertTrue(
    arrived.run.stepLive,
    "run.stepLive on the arriving tick: the step is taken and not yet found " +
      "complete (specs/state.md)",
  );

  assertEqual(
    after.run.tick,
    arrived.run.tick + 1,
    "the tick read after the arrival",
  );
  assertEqual(
    after.run.stepIndex,
    1,
    "run.stepIndex on the tick after the arrival: the step is found complete " +
      "at the top of that tick, which is the tick that takes the step " +
      "following it (specs/program.md)",
  );
});
