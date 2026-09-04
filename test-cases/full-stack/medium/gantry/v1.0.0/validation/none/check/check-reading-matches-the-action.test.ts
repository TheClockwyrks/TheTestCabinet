// check/check-reading-matches-the-action — the `check` reading answers exactly
// what the `check` action leaves on the build screen.
//
// specs/instrumentation.md § Readings: "`check` reports exactly what the `check`
// action reports", in the shape `{ issues, cost, budget, stable, members }`, and
// "The reading is pure: it computes the check and returns it, and it displays
// nothing, so the result the build screen is showing is untouched." So the two
// are one computation reached two ways, and the way to decide that is to reach it
// both ways over one untouched structure and compare field for field.
//
// THE ACTION FIRST, THE READING SECOND, over a crane and a tape that are never
// touched in between: specs/structure.md says the shown result "stands until the
// structure or the tape changes", so nothing here changes either, and any
// difference between the two is a difference between the two paths.
//
// The crane is the minimal one and the tape is one step, so the check has
// something to report on every field: no readiness issue, a cost against the
// site's budget, a verdict, and a member list.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { BINDINGS, HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The key `specs/controls.md` binds the `check` action to. */
const CHECK_KEY = BINDINGS.check[0]!;

/** One step, so the tape is not empty and the check has a cost to report. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
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

it("answers the reading the check action left on the build screen", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  // The action, taken on the build screen where `specs/ui.md` puts it.
  await h.press(CHECK_KEY);
  const shown = (await h.snapshot()).checkResult;
  assertNotNull(
    shown,
    "the result the `check` action leaves on the build screen " +
      "(specs/structure.md)",
  );

  // The reading, over the same untouched structure and tape.
  const read = await h.check();

  await h.advance(1);
  await h.capture(
    "check-shown",
    "the check action's result on the build screen",
  );

  assertDeepEqual(
    read.issues,
    shown?.issues,
    "the reading's issues against the action's, each once and in the order " +
      "specs/structure.md lists them (specs/instrumentation.md)",
  );
  assertEqual(
    read.cost,
    shown?.cost,
    "the reading's cost against the action's",
  );
  assertEqual(
    read.budget,
    shown?.budget,
    "the reading's budget against the action's",
  );
  assertEqual(
    read.stable,
    shown?.stable,
    "the reading's verdict against the action's",
  );
  assertDeepEqual(
    read.members,
    shown?.members,
    "the reading's member list against the action's: the same ids in " +
      "member-id order, with the same force and utilization",
  );
});
