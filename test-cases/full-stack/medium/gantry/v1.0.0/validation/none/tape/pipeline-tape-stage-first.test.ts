// tape/pipeline-tape-stage-first — the tape stage runs before any axis moves.
//
// `specs/program.md` § The tick pipeline puts the tape first and the axes second:
// "1. The tape: … If no step is live, this tick takes the next one … 2. Axis
// motion: advance every commanded axis under the controller above." § The tape
// says what taking a step can decide there: "A step whose command targets a value
// outside its axis's range at that moment ends the run as `command-out-of-range`
// … it is judged when the step starts." So the tick that starts an unreachable
// step ends the run at stage 1, and stage 2 never runs on it.
//
// THE STEP CARRIES A SECOND COMMAND THAT COULD MOVE, which is what makes the
// ordering readable. Its hoist target is below `HOIST_MIN` (`1`) and its slew
// target is ninety degrees away at `SLEW_MAX_RATE`, well inside the slew's range,
// which `specs/program.md` leaves unbounded. Had the axes been advanced before
// the step was judged, the slew would stand `SLEW_ACCEL / TICK_HZ^2` past zero
// with a rate of half a degree a second; the run-start posture instead stands
// untouched, at `slew` `0` and `hoist` `HOIST_START`, each stopped.
//
// The failing tick is the run's first, which is the earliest the requirement can
// be read and leaves nothing else in the reading. The yard is emptied and the
// crane is the minimal one: the requirement is about the order of two stages.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_MIN,
  HOIST_START,
  SLEW_MAX_RATE,
} from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One step: an unreachable hoist target, and a slew that would move. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_MIN - 1, rate: HOIST_MAX_RATE },
      { axis: "slew", target: 90, rate: SLEW_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves no axis on the tick the tape stage ends the run", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  const started = await startRun(h);
  assertEqual(started.run.axes.slew.value, 0, "the slew at the run's start");

  const failed = await runTicks(h, 1);
  await h.capture("state", "The axes on the tick the tape stage ended the run");

  assertEqual(failed.run.tick, 1, "the tick the step was taken on");
  assertEqual(
    failed.run.cause,
    "command-out-of-range",
    "the cause a step whose target is outside its axis's range ends the run " +
      "with (specs/program.md)",
  );
  assertEqual(
    failed.run.axes.slew.value,
    0,
    "the slew's value on the failing tick: the tape stage ended the run " +
      "before any axis moved, so the axis its other command would have driven " +
      "stands where the run started it (specs/program.md)",
  );
  assertEqual(
    failed.run.axes.slew.rate,
    0,
    "the slew's rate on the failing tick, which no controller ran on",
  );
  assertEqual(
    failed.run.axes.hoist.value,
    HOIST_START,
    "the hoist's value on the failing tick",
  );
});
