// campaign/select-highlight-lands-on-last-entered — the select screen lands on
// the challenge the session entered last.
//
// THE RULE. "On arriving at the screen the highlight sits on the challenge most
// recently entered or solved, and on challenge `1` before any has been entered"
// (`specs/modes/campaign.md`, The select screen). This point decides the ENTERED
// half: a challenge opened from its row and left again, with nothing solved
// anywhere, is where the highlight sits the next time the screen is arrived at.
// The fresh session's landing on challenge 1 and the landing after a SOLVE are
// their own items.
//
// THE ENTERING IS THE PLAYER'S. A challenge is entered by taking its row:
// "`confirm` on an unlocked or solved challenge opens it in the editor"
// (`specs/modes/campaign.md`), pressed through the key `specs/controls.md` binds,
// since "Menus and select lists are worked from the keyboard alone"
// (`specs/ui.md`). It is not entered through `openChallenge`, which "touches no
// progress: the unlocked count, the solved sets, the records, the per-challenge
// stashes, and both `last` figures stand as they are"
// (`specs/instrumentation.md`) — an operation that deliberately does NOT count as
// entering.
//
// THE ROW ENTERED IS NOT THE ONE THE SESSION STARTED ON. Challenge 3's row is
// entered, so the landing has to be challenge 3 rather than the challenge 1 a
// fresh session lands on. `setUnlockedCount(3)` opens it — "Sets how many campaign
// challenges are open" — and nothing is solved, which the verdict reads back.
//
// AND THE HIGHLIGHT IS PUT SOMEWHERE ELSE BEFORE THE ARRIVAL. Entering a row
// leaves the highlight on it, so `setSelectIndex(0)` is posed while the editor is
// open and the screen is then arrived at: `setScreen`'s table says `select` "shows
// the current mode's select screen, `selectIndex` at that mode's `last`"
// (`specs/instrumentation.md`). A build that computes the landing reports the row
// it entered; a build that merely left the highlight where it stood reports `0`.
//
// THE VERDICT. `selectIndex` is the entered row, and so is `campaign.last`, with
// the solved set still empty.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  pressAction,
  type Harness,
} from "../harness";

/** The row entered: challenge 3, two rows away from a fresh session's landing. */
const ENTERED_ROW = 2;

/** Where the highlight is posed before the arrival, which is not the landing. */
const POSED_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the highlight on the challenge entered from its row", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    ENTERED_ROW,
    `the course holds a challenge ${ENTERED_ROW + 1}, which is the row entered`,
  );
  await h.debug.setUnlockedCount(ENTERED_ROW + 1);

  await openSelect(h, "campaign");
  await h.debug.setSelectIndex(ENTERED_ROW);
  await h.advance(1);
  await pressAction(h, "confirm");

  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "editor",
    "confirm on an unlocked challenge opens it in the editor, which is the " +
      "entering this point is about",
  );
  assertNotNull(
    entered.challenge,
    "the challenge taken from its row is the one open in the editor",
  );
  assertEqual(
    entered.challenge?.source,
    "campaign",
    "the challenge entered is the course's own, at the row that was taken",
  );
  assertEqual(
    entered.challenge?.index,
    ENTERED_ROW,
    "the row taken is the challenge that was entered",
  );

  await h.debug.setSelectIndex(POSED_ROW);
  await h.debug.setScreen("select");
  await h.advance(1);
  await captureStill(h, "landing");

  const arrived = await h.snapshot();
  assertEqual(
    arrived.screen,
    "select",
    "the arrival puts the game back on the select screen",
  );
  assertDeepEqual(
    arrived.campaign.solved,
    [],
    "the challenge was entered and left without being solved, so the landing " +
      "read below is the one the ENTERING fixed",
  );
  assertEqual(
    arrived.selectIndex,
    ENTERED_ROW,
    "on arriving the highlight sits on the challenge most recently entered",
  );
  assertEqual(
    arrived.campaign.last,
    ENTERED_ROW,
    "the row the campaign's select screen lands on is the challenge last entered",
  );
});
