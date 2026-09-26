// campaign/select-highlight-starts-on-challenge-one — before anything has been
// entered, the campaign select screen lands on challenge 1.
//
// THE RULE. "One row is highlighted, drawn distinctly from the rest. On arriving
// at the screen the highlight sits on the challenge most recently entered or
// solved, and on challenge `1` before any has been entered"
// (`specs/modes/campaign.md`, The select screen). This point decides the SECOND
// half of that sentence, the landing of a session that has entered nothing; the
// challenge most recently entered and the one most recently solved are their own
// items, and `up` and `down` are theirs.
//
// WHERE THE FIGURE IS READ. The highlighted row is `selectIndex`, "the highlighted
// select row of the current mode" (`specs/state.md`), and challenge `1` is index
// `0`, since the course is "numbered from `1`" (`specs/modes/campaign.md`) and the
// surface indexes it from `0` throughout. The landing figure itself is
// `campaign.last`, "where the select screen lands", whose resting value the
// snapshot table gives as `0`.
//
// THE ARRIVAL IS POSED, AND THE HIGHLIGHT IS PUT SOMEWHERE ELSE FIRST. `setScreen`
// "enters the screen `name`, exactly as the real transition into it enters it",
// and its table says `select` "shows the current mode's select screen,
// `selectIndex` at that mode's `last`" (`specs/instrumentation.md`). So the check
// poses `setSelectIndex` at a row that is neither the landing nor a neighbour of
// it, and only then arrives. A build that computes the landing reports `0`; a
// build that merely leaves the highlight where it last stood reports the row that
// was posed, and this point is the difference between them.
//
// THE WORLD IS A FRESH SESSION: `reset` "leaves the game indistinguishable from a
// freshly started session" (`specs/instrumentation.md`), which is "nothing solved,
// and only the first campaign challenge unlocked" (`specs/state.md`) — the state
// the sentence above is written about.
//
// THE VERDICT. `selectIndex` is `0` on arrival, and the mode's `last` is `0` too,
// so the highlight sits on challenge 1.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * The row the highlight is posed on before the arrival.
 *
 * Two away from the landing, so a build that moved the highlight by one row
 * rather than computing the landing is still reported. The course holds at least
 * `CAMPAIGN_MIN` (`8`) challenges, so the row exists; the check reads the shipped
 * count and says so rather than assuming it.
 */
const POSED_ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the campaign highlight on challenge 1 when nothing has been entered", async () => {
  await h.debug.reset();
  const fresh = await h.snapshot();
  assertGreaterThan(
    fresh.campaign.count,
    POSED_ROW,
    `the course holds more than ${POSED_ROW + 1} challenges, so the highlight ` +
      "can be posed away from the row it must land on",
  );
  assertDeepEqual(
    fresh.campaign.solved,
    [],
    "a freshly started session has solved nothing, so nothing has been entered " +
      "or solved for the highlight to sit on",
  );

  await h.debug.setMode("campaign");
  await h.debug.setSelectIndex(POSED_ROW);
  assertEqual(
    (await h.snapshot()).selectIndex,
    POSED_ROW,
    "the highlight is posed away from challenge 1 before the arrival, so the " +
      "landing is read rather than a figure that never moved",
  );

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
    arrived.mode,
    "campaign",
    "the screen serves the campaign, whose course this point is about",
  );
  assertEqual(
    arrived.selectIndex,
    0,
    "before any challenge has been entered the highlight sits on challenge 1",
  );
  assertEqual(
    arrived.campaign.last,
    0,
    "the row the campaign's select screen lands on is challenge 1 until " +
      "something is entered or solved",
  );
});
