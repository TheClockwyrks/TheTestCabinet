// tape/command-out-of-range-from-any-command-in-a-step — one unreachable command
// in a step ends the run, whatever the step's other commands.
//
// `specs/program.md` § The tape: "A step whose command targets a value outside
// its axis's range at that moment ends the run as `command-out-of-range`." The
// rule is written of the step rather than of the command, so a move carrying one
// reachable target and one unreachable one is a step that ends the run.
//
// THE STEP CARRIES TWO COMMANDS, on two axes, and only the second is out of
// range. The slew is "unbounded", so `90` is reachable on any crane; the hoist
// runs from `HOIST_MIN` (`1`) to `HOIST_MAX` (`40`), so `41` is a unit past the
// top of its range and reachable on none. A build that judged only the step's
// first command, or that judged a step by whether ANY of its commands was
// reachable, runs on; a build that judges every command ends the run here.
//
// The editor takes the step as written — "Targets are accepted as written:
// whether a target is reachable depends on the structure, so it is judged when
// the step starts" — so the tape holds both commands and the verdict falls on the
// first tick, which is the tick that takes the step (`specs/program.md` § The
// tick pipeline). The world holds nothing but the smallest crane that stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE, SLEW_MAX_RATE } from "../constants";
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

/** One unit past the top of the hoist's range, which ends at `HOIST_MAX`. */
const UNREACHABLE = HOIST_MAX + 1;

/** One step, two axes: a reachable slew target and an unreachable hoist one. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: 90, rate: SLEW_MAX_RATE },
      { axis: "hoist", target: UNREACHABLE, rate: HOIST_MAX_RATE },
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

it("ends the run on the step whose second command is out of range", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const taken = await runTicks(h, 1);

  await h.capture("state", "The run the two-command step ended");

  assertEqual(
    taken.run.phase,
    "failed",
    "the phase one tick after a step carrying a reachable slew target and a " +
      `hoist target of ${UNREACHABLE}, past HOIST_MAX (specs/program.md)`,
  );
  assertEqual(
    taken.run.cause,
    "command-out-of-range",
    "the cause a step with any command outside its axis's range carries " +
      "(specs/program.md)",
  );
});
