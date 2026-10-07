// campaign/select-highlight-lands-on-last-solved — the select screen lands on the
// challenge the session solved last.
//
// THE RULE. "On arriving at the screen the highlight sits on the challenge most
// recently entered or solved, and on challenge `1` before any has been entered"
// (`specs/modes/campaign.md`, The select screen). This point decides the SOLVED
// half: a challenge whose run completed is where the highlight sits the next time
// the screen is arrived at. The fresh session's landing and the landing after an
// entering that solved nothing are their own items.
//
// THE SOLVE IS A REAL ONE. "a challenge is solved by a run that completes"
// (`specs/modes/campaign.md`), and a completing boundary "records the metrics,
// marks the challenge solved, and unlocks what its mode unlocks"
// (`specs/instrumentation.md`, the `completion` faculty). So the challenge is
// taken from its row the player's way — "`confirm` on an unlocked or solved
// challenge opens it in the editor" — loaded with the build's OWN reference
// solution, which "completes without faulting within `CAMPAIGN_REFERENCE_CYCLES`
// (`600`) cycles of the run's start" (`specs/modes/campaign.md`), and run until it
// completes. Nothing about the landing is posed: `setLast` is never called here,
// because the figure it writes is the figure this point is deciding.
//
// THE ROW SOLVED IS NOT THE ONE A FRESH SESSION LANDS ON. Challenge 3's row is
// taken, so the landing has to be challenge 3 rather than challenge 1.
// `setUnlockedCount(3)` opens the row — "Sets how many campaign challenges are
// open" — which touches nothing else.
//
// AND THE HIGHLIGHT IS PUT SOMEWHERE ELSE BEFORE THE ARRIVAL, so what is read is
// the landing the build COMPUTES rather than a highlight that never moved:
// `setScreen`'s table says `select` "shows the current mode's select screen,
// `selectIndex` at that mode's `last`" (`specs/instrumentation.md`).
//
// THE VERDICT. The completed challenge is in the solved set, and arriving at the
// select screen puts `selectIndex` and the mode's `last` on its row.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { CAMPAIGN_REFERENCE_CYCLES, SPEEDS } from "../constants";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  loadMachine,
  openSelect,
  pressAction,
  referenceSolution,
  setSpeed,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The row solved: challenge 3, two rows away from a fresh session's landing. */
const SOLVED_ROW = 2;

/** Where the highlight is posed before the arrival, which is not the landing. */
const POSED_ROW = 0;

/**
 * The fastest speed step. A run's outcome does not turn on it — "`advance(1, 1)`
 * and `advance(1, 60)` cover the same cycles and reach the same outcome"
 * (`specs/instrumentation.md`) — so the fastest step is chosen for one reason
 * only: a cycle is `1 / SPEEDS[speed]` seconds, so it is the shortest span of
 * game time the budget's cycles can be driven as.
 */
const FAST_SPEED = SPEEDS.length - 1;

/** How many cycles one call to the clock covers, in ONE frame; "the span is the
 * same however it is divided", so a run that finishes early costs only the steps
 * it needed. */
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

it("lands the highlight on the challenge whose run completed", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    SOLVED_ROW,
    `the course holds a challenge ${SOLVED_ROW + 1}, which is the row solved`,
  );
  await h.debug.setUnlockedCount(SOLVED_ROW + 1);

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(SOLVED_ROW);
  await h.advance(1);
  await pressAction(h, "confirm");
  const entered = await h.snapshot();
  assertNotNull(
    entered.challenge,
    "confirm on the unlocked row opens that challenge in the editor, which is " +
      "where the run this point solves is set up",
  );
  assertEqual(
    entered.challenge?.index,
    SOLVED_ROW,
    "the challenge open is the one whose row was taken",
  );

  await loadMachine(h, await referenceSolution(h, "campaign", SOLVED_ROW));
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);
  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    `campaign challenge ${SOLVED_ROW + 1} completes within ` +
      "CAMPAIGN_REFERENCE_CYCLES (600) cycles on its own reference solution, " +
      "which is the solve this point's world is built on",
  );
  assertContains(
    finished.campaign.solved,
    SOLVED_ROW,
    "the completed run marks its challenge solved, so there is a challenge " +
      "most recently solved for the highlight to sit on",
  );

  await h.debug.setSelectIndex(POSED_ROW);
  await h.debug.setScreen("select");
  await h.advance(1);
  await captureStill(h, "landing");

  const arrived = await h.snapshot();
  assertEqual(
    arrived.screen,
    "select",
    "the arrival puts the game on the select screen this point reads",
  );
  assertEqual(
    arrived.selectIndex,
    SOLVED_ROW,
    "on arriving the highlight sits on the challenge most recently solved",
  );
  assertEqual(
    arrived.campaign.last,
    SOLVED_ROW,
    "the row the campaign's select screen lands on is the challenge last solved",
  );
});
