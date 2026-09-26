// extras/select-lands-on-the-last-solved — the shelf reopens on the challenge just
// completed.
//
// THE RULE. The Extras select screen's highlight and "its resting position on
// arrival" are as `specs/modes/campaign.md` states them
// (`specs/modes/extras.md`, The select screen), and that file states: "On arriving
// at the screen the highlight sits on the challenge most recently entered or
// SOLVED, and on challenge `1` before any has been entered." What makes a challenge
// solved is a run that finishes it: "A challenge is solved by a run that completes"
// (`specs/modes/extras.md`), and "Completing a challenge marks it solved for the
// session" (Progression). The snapshot carries the resting row as `extras.last`,
// "where the select screen lands", and arriving reads it: "`select` — Shows the
// current mode's select screen, `selectIndex` at that mode's `last`"
// (`specs/instrumentation.md`).
//
// THE SCENARIO IS THE ONE A PLAYER PLAYS, and it is the whole of what this point
// decides: challenge 6 is opened from the shelf with `confirm`, its run is played
// out to completion on the build's own reference solution, and the shelf is
// arrived at again. `specs/modes/extras.md` requires that solution to exist and to
// finish — "Every Extras challenge ships a reference solution under the
// requirement `specs/modes/campaign.md` states for a course challenge", which is
// one "whose run completes without faulting within `CAMPAIGN_REFERENCE_CYCLES`
// (`600`) cycles" — so running it out is a posing step rather than a verdict.
//
// THE ROW THE HIGHLIGHT MUST LAND ON IS READ OFF THE SOLVED SET rather than
// written down here, so what the check compares is the row the shelf landed on
// against the challenge the game itself reports as solved. The shelf starts landing
// on row 1, and row 6 is not row 1, so a build that lands wherever it opened, or
// that always lands on the first row, is reported.
//
// THE VERDICT. Completing Extras 6 and arriving at the shelf puts the highlight on
// row 6 — `selectIndex` `5`, the challenge the shelf reports solved — and the
// Extras' resting row is that challenge's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { EXTRA_NAMES } from "../challenges";
import { CAMPAIGN_REFERENCE_CYCLES, SPEEDS } from "../constants";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  loadMachine,
  openSelect,
  openTitle,
  pressAction,
  referenceSolution,
  setSpeed,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The Extras challenge completed, and the row a fresh shelf lands on. */
const SOLVED_INDEX = 5;
const FIRST_ROW = 0;

/** The fastest speed step, which is the shortest span of game time the
 * reference's cycle budget can be driven as. */
const FAST_SPEED = SPEEDS.length - 1;

/** How many cycles one call to the clock covers, in ONE frame, while the
 * reference is run out; "the span is the same however it is divided". */
const CYCLES_PER_STEP = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Run the live machine until it stops running, or the reference budget runs out. */
async function settle(): Promise<OrrerySnapshot> {
  let snapshot = await h.snapshot();
  for (
    let covered = 0;
    covered < CAMPAIGN_REFERENCE_CYCLES && snapshot.sim?.status === "running";
    covered += CYCLES_PER_STEP
  ) {
    await advanceCycles(h, CYCLES_PER_STEP, 1);
    snapshot = await h.snapshot();
  }
  return snapshot;
}

it("lands the shelf on the challenge it has just completed", async () => {
  await openTitle(h);
  assertEqual(
    (await h.snapshot()).extras.last,
    FIRST_ROW,
    "a reset leaves both select screens landing on their first row, so row 6 is " +
      "somewhere the shelf does not already land",
  );

  await openSelect(h, "extras");
  await h.debug.setSelectIndex(SOLVED_INDEX);
  await pressAction(h, "confirm");
  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "editor",
    "confirm on an Extras row opens that challenge in the editor",
  );
  assertEqual(
    opened.challenge?.index,
    SOLVED_INDEX,
    `the challenge open is Extras ${SOLVED_INDEX + 1}, ` +
      `${EXTRA_NAMES[SOLVED_INDEX] ?? ""}`,
  );

  await loadMachine(h, await referenceSolution(h, "extras", SOLVED_INDEX));
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);
  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    `Extras challenge ${SOLVED_INDEX + 1} completes within ` +
      "CAMPAIGN_REFERENCE_CYCLES (600) cycles on the reference solution the build " +
      "ships for it, which is how this point's challenge is solved",
  );

  await openSelect(h, "extras");
  await captureStill(h, "landed");

  const arrived = await h.snapshot();
  assertDeepEqual(
    arrived.extras.solved,
    [SOLVED_INDEX],
    "the completed challenge is the one the shelf reports solved, and it is the " +
      "only one",
  );
  assertNotEqual(
    arrived.selectIndex,
    FIRST_ROW,
    "arriving does not put the highlight back on the shelf's first row",
  );
  assertEqual(
    arrived.selectIndex,
    arrived.extras.solved[0],
    "the highlight sits on the challenge the shelf reports solved, which is the " +
      "one just completed: row 6",
  );
  assertEqual(
    arrived.extras.last,
    SOLVED_INDEX,
    "and the shelf's resting row is that challenge's",
  );
});
