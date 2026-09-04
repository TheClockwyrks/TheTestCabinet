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
// around as often as it likes"), so twice the target is a value a wrong build
// reaches rather than one its range refuses. The world holds no loads and no
// obstacles, and the crane is the smallest that stands.
//
// THE TARGET IS THE SMALLEST THAT SEPARATES THE TWO READINGS. What decides the
// point is whether the second step moves the axis at all, not how far the first
// one carried it, so the tape names five degrees rather than ninety: a correct
// build stops at `5` and a build reading the target as an offset stops at `10`,
// which the `1e-9` tolerance below tells apart as surely as `90` from `180` and
// in a tenth of the run clock.
//
// THE RUN IS CARRIED IN ONE BATCH AND THEN SWEPT. Nothing between the start and
// the end is read, so the ticks in between are driven rather than sampled; the
// sweep that finds the end is given room for the second step a WRONG build
// takes, so a build that reads the target as an offset reaches its own ending
// and is graded on what it left rather than on a cap.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where both steps send the slew, in degrees. */
const TARGET = 5;

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
 * Ticks driven in one batch before the sweep begins.
 *
 * `TARGET` degrees under `SLEW_ACCEL` is a ramp up and straight back down over
 * `2 * sqrt(TARGET / SLEW_ACCEL)` seconds — some forty-nine ticks — so forty is
 * short of the first step's arrival on any conformant build and nothing that
 * happens inside it is read.
 */
const CARRY = 40;

/**
 * Ticks the sweep is given after that.
 *
 * Enough for the second step a build reading the target as an offset takes, so
 * such a build ends its own run and is graded on the slew it left.
 */
const CAP = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the slew at the target both steps name, not twice it", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  await runTicks(h, CARRY);
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
