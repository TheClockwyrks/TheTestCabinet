// tape/command-target-is-absolute — a command drives its axis to an absolute
// value, so repeating a target moves the axis no further.
//
// `specs/program.md` § The tape: "A command is `{ axis, target, rate }`: drive
// that axis to the absolute `target` at up to `rate`." § Axis motion says the
// same thing from the controller's side, where the distance to go is `d = T - x`
// against the axis's current value rather than against where the step began.
//
// TWO STEPS CARRYING THE SAME COMMAND is the scenario that separates the two
// readings. A build that treated a target as an offset drives the slew to `90`
// on the first step and on to `180` on the second; a build that reads it as an
// absolute value finds the second step's axis already there — "A command whose
// target is the axis's current value therefore has `s` of `0`: the axis neither
// brakes nor accelerates, it does not move, and step 3 finds it arrived" — and
// leaves the slew at `90`.
//
// The step index is read beside it because the two readings a wrong build gives
// are `180` and `90`: a build that silently dropped the second step would also
// leave the slew at `90`, and `run.stepIndex` reaching the tape's length says
// the second step was taken and completed rather than skipped.
//
// The slew is the axis to say this on: it is unbounded ("a tape may wind the arm
// around as often as it likes"), so `180` is a value a wrong build reaches
// rather than one its range refuses. The world holds no loads and no obstacles,
// and the crane is the smallest that stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
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

/** Where both steps send the slew, in degrees. */
const TARGET = 90;

/** The same command twice: the second has nowhere left to drive. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
  },
];

/**
 * Ticks the whole tape is given. The slew accelerates at `SLEW_ACCEL` to
 * `SLEW_MAX_RATE` and brakes to a stop over `TARGET` degrees, which is four
 * seconds; a build reading the target as an offset takes about seven.
 */
const CAP = 900;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the slew at the target both steps name, not twice it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the two-step tape to run out",
  );

  await h.capture("state", "The slew where two commands to 90 left it");

  assertEqual(
    ended.run.stepIndex,
    TAPE.length,
    "run.stepIndex once the tape has run out: the second step was taken and " +
      "completed (specs/program.md)",
  );
  assertClose(
    ended.run.axes.slew.value,
    TARGET,
    1e-9,
    `run.axes.slew.value after two commands to an absolute ${TARGET} ` +
      "degrees (specs/program.md)",
  );
});
