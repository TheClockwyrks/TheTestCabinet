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
// the axes far from the run-start posture. `MINIMAL_CRANE` is the crane, and it
// is asymmetric about the slew axis through `(1, ·, 1)` — the arm's mast stands
// at `(0, 8, 0)` and its track runs out to `(4, 4, 0)` — so where the arm is
// pointed genuinely changes what its members carry, and a check solved at a slew
// of `90` would read visibly different forces from one solved at `0`. The tape
// slews the arm a quarter turn and runs the trolley two units out along its
// four-unit track, and the run is driven until it ends.
//
// The yard is emptied first, so what the run carries out is the tape's motion
// and nothing else: with no load to attach there is no rigging to reach a
// verdict about, and the run ends when the tape does.
//
// The two readings are compared member for member by id. Both are the same
// computation over the same structure at the same posture, and specs/state.md
// makes the simulation deterministic, so the tolerance is only what a float
// round trip through the page can cost.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertGreaterThan } from "../assert";
import { SLEW_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
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

/**
 * A quarter turn of the arm and two units of trolley travel, in one move step.
 *
 * `90` degrees is a posture no symmetry maps back onto `0` for this crane, and
 * `2` is inside the four-unit track the minimal crane's single rail forms
 * (specs/program.md: the trolley's range is "`0` to the track length").
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: 90, rate: SLEW_MAX_RATE },
      { axis: "trolley", target: 2, rate: TROLLEY_MAX_RATE },
    ],
  },
];

/** Comfortably past the four seconds the slew command takes at `SLEW_MAX_RATE`. */
const RUN_CAP = 1200;

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
  await clearAll(h);
  await standMinimalCrane(h);

  const before = (await h.check()).members;

  await poseTape(h, TAPE);
  await startRun(h);
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
