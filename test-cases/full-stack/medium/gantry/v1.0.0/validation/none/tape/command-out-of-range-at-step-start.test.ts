// tape/command-out-of-range-at-step-start — a step whose command targets a value
// outside its axis's range ends the run, at the moment the step starts.
//
// `specs/program.md` § The tape: "Targets are accepted as written: whether a
// target is reachable depends on the structure, so it is judged when the step
// starts. A step whose command targets a value outside its axis's range at that
// moment ends the run as `command-out-of-range`."
//
// THE TAPE IS ONE STEP AND THE READING IS ONE TICK, which is what makes the check
// about WHEN the judgement falls rather than only about whether it falls at all.
// `specs/program.md` § The tick pipeline puts the tape first: "If no step is live,
// this tick takes the next one", and a run's first tick is the tick that takes the
// first step. So the run stands failed after exactly one tick — before any axis has
// moved, and long before the axis could have reached the target it was given.
//
// THE HOIST IS THE AXIS BECAUSE IT IS THE BOUNDED ONE THAT NEEDS NO STRUCTURE.
// `specs/program.md` gives it the fixed range `HOIST_MIN` to `HOIST_MAX`, so the
// target `41` is outside the range of every crane on every site; the trolley's
// bound moves with the track and the other two axes have none. The editor takes
// the step: the tape editor bounds a command's RATE and nothing else, and
// "Targets are accepted as written".
//
// The crane is the harness's minimal one and the yard is empty: the run needs a
// ready structure to start at all, and nothing else here concerns it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Outside the hoist's range on every crane, on every site. */
const TARGET = HOIST_MAX + 1;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: TARGET, rate: HOIST_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as command-out-of-range on the tick that takes the step", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const first = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    first.run.tick,
    1,
    "the tick the reading is taken on: the first, which is the tick that " +
      "takes the first step (specs/program.md)",
  );
  assertEqual(
    first.run.phase,
    "failed",
    `the phase of a run whose first step targets the hoist at ${TARGET}, ` +
      "outside its range (specs/program.md)",
  );
  assertEqual(
    first.run.cause,
    "command-out-of-range",
    "the cause a step whose target is outside its axis's range ends the run " +
      "with (specs/program.md)",
  );
});
