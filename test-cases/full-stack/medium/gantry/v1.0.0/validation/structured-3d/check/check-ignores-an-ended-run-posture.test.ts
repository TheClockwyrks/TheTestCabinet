// check/check-ignores-an-ended-run-posture — the check solves at the run-start
// posture whatever a finished run left the axes at.
//
// specs/structure.md § The static check: the action "reads the structure as it
// stands, without starting a run", and "the two solves of `specs/statics.md` run
// at the run-start posture `specs/program.md` fixes, `slew` `0`, `trolley` `0`,
// `hoist` `HOIST_START`, and `grip` `0`, with the bare hook hanging at rest and
// nothing moving". The posture the check solves at is therefore a fixed one, and
// the run's own axes are not it. specs/program.md § Starting and ending a run
// says the same from the run's side: "Either way the structure, the tape, and
// the loads' starting poses are untouched: every run begins from the same
// authored state".
//
// The scenario reads the same crane's forces before and after a run that leaves
// the axes away from the run-start posture. `MINIMAL_CRANE` is the crane, and it
// is asymmetric about the slew axis through `(1, ·, 1)` — the arm's mast stands
// at `(0, 8, 0)` and its track runs out to `(4, 4, 0)` — so where the arm is
// pointed genuinely changes what its members carry, and a check solved at a
// slewed, run-out posture reads different forces from one solved at the
// run-start posture. The tape slews the arm and runs the trolley out along its
// four-unit track, and the run is driven until it ends.
//
// THE SLEW IS FIVE DEGREES RATHER THAN NINETY. What the point turns on is that
// the check ignores WHERE the finished run left the axes, and any posture that is
// not the run-start one says that: the two solves are the same computation, so a
// build that solved at the run's posture instead differs by the whole effect of
// the arm having moved and of the trolley standing off its origin, which the
// `1e-9` tolerance below separates from equality by many orders of magnitude.
// Ninety degrees would spend four seconds of run clock reaching a reading five
// already gives.
//
// THE RUN IS CARRIED IN ONE BATCH AND THEN SWEPT. Nothing between the start and
// the end of the run is read — the two force lists are read off the CHECK, on
// the build screen, either side of it — so the ticks in between are driven
// rather than sampled.
//
// The yard is emptied first, so what the run carries out is the tape's motion
// and nothing else: with no load to attach there is no rigging to reach a
// verdict about, and the run ends when the tape does.
//
// The two readings are compared member for member by id. Both are the same
// computation over the same structure at the same posture, so the tolerance is
// only what a float round trip through the page can cost.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertGreaterThan } from "../assert";
import { SLEW_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
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

/** Where the arm is left: a posture no symmetry maps back onto `0`. */
const SLEW_TARGET = 5;

/**
 * How far out the trolley is left: inside the four-unit track the minimal
 * crane's single rail forms (specs/program.md: the trolley's range is "`0` to
 * the track length"), and clear of the `0` the run started it at.
 */
const TROLLEY_TARGET = 1.2;

/** A slew of the arm and a run of the trolley, together in one move step. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: SLEW_TARGET, rate: SLEW_MAX_RATE },
      { axis: "trolley", target: TROLLEY_TARGET, rate: TROLLEY_MAX_RATE },
    ],
  },
];

/**
 * Ticks driven in one batch before the sweep begins.
 *
 * The trolley is the slower of the two: `TROLLEY_TARGET` units under
 * `TROLLEY_ACCEL` is a ramp up and straight back down over
 * `2 * sqrt(TROLLEY_TARGET / TROLLEY_ACCEL)` seconds — some sixty-six ticks —
 * against the slew's `2 * sqrt(SLEW_TARGET / SLEW_ACCEL)`, some forty-nine. So
 * fifty-eight is short of the tape running out on any conformant build.
 */
const CARRY = 58;

/** Ticks the sweep is given after that, for the run to end. */
const RUN_CAP = 120;

/** A float round trip through the page, and nothing else: the solve is the same one. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the same forces after a run that ended with the arm slewed and the trolley out", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);

  const before = (await h.check()).members;

  await poseTape(h, TAPE);
  await startRun(h);
  await runTicks(h, CARRY);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    RUN_CAP,
    "the run to end",
  );

  await h.debug.setScreen("build");
  const after = (await h.check()).members;

  await h.advance(1);
  await h.capture(
    "both-member-lists-run-axes-at-the-end-of-the-ru",
    "the crane whose forces are read either side of a slewed, run-out run",
  );

  assertGreaterThan(
    Math.abs(ended.run.axes.slew.value),
    1,
    "the slew the finished run left the arm at, away from the run-start `0` " +
      "(specs/program.md § The axes)",
  );
  assertGreaterThan(
    Math.abs(ended.run.axes.trolley.value),
    1,
    "the trolley position the finished run left, away from the run-start `0` " +
      "(specs/program.md § The axes)",
  );

  assertEqual(
    after.length,
    before.length,
    "the members the second check reports, the structure being the one the " +
      "run left untouched (specs/program.md § Starting and ending a run)",
  );
  for (const [index, was] of before.entries()) {
    const now = after[index];
    assertEqual(now?.id, was.id, `the id at position ${index} of the members`);
    assertClose(
      now?.force ?? Number.NaN,
      was.force,
      TOLERANCE,
      `member ${was.id}'s force, solved at the run-start posture both times ` +
        "(specs/structure.md § The static check)",
    );
    assertClose(
      now?.utilization ?? Number.NaN,
      was.utilization,
      TOLERANCE,
      `member ${was.id}'s utilization, solved at the run-start posture both ` +
        "times (specs/structure.md § The static check)",
    );
  }
});
