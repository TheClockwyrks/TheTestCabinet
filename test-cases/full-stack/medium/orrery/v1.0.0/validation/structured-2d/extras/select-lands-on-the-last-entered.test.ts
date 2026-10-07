// extras/select-lands-on-the-last-entered — the shelf reopens on the challenge
// last entered.
//
// THE RULE. The Extras select screen's highlight and "its resting position on
// arrival" are as `specs/modes/campaign.md` states them
// (`specs/modes/extras.md`, The select screen), and that file states: "On arriving
// at the screen the highlight sits on the challenge most recently ENTERED or
// solved, and on challenge `1` before any has been entered." The snapshot carries
// the figure as `extras.last`, "where the select screen lands"
// (`specs/instrumentation.md`), and arriving reads it: "`select` — Shows the
// current mode's select screen, `selectIndex` at that mode's `last`."
//
// ENTERED, AND ENTERED THE PLAYER'S WAY. "`confirm` on an unlocked or solved
// challenge opens it in the editor" (`specs/modes/campaign.md`), and every Extras
// row can be entered: "Every challenge is unlocked from the start and can be
// entered in any order" (`specs/modes/extras.md`). So challenge 4 is entered from
// the shelf itself, with the highlight moved onto its row and `confirm` pressed,
// rather than through the surface's `openChallenge` — which "touches no progress"
// and would leave the figure where it lay.
//
// THE HIGHLIGHT IS THEN DISPLACED, to row 7, after backing out to the shelf and
// before leaving for the title. `setSelectIndex` "Sets the highlighted row of the
// current mode's select screen" and nothing else — "Each pose sets one thing and
// leaves the rest of the game as it stands" (`specs/instrumentation.md`) — so
// moving the highlight is not entering anything, and `last` stands at the row that
// was. Without the displacement a build that never recorded a resting row at all
// would pass by leaving the highlight where the player left it; with it, the only
// way to land back on row 4 is to have kept the row that was entered.
//
// THE VERDICT. After entering Extras 4, backing out to the shelf, leaving to the
// title and returning, the highlight is on row 4 — `selectIndex` `3` — and the
// Extras' resting row is that challenge's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { EXTRA_NAMES } from "../challenges";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** The Extras challenge entered, and the row the highlight is displaced to after. */
const ENTERED_INDEX = 3;
const DISPLACED_ROW = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands the shelf on the challenge last entered rather than where the highlight lay", async () => {
  await openTitle(h);
  assertEqual(
    (await h.snapshot()).extras.last,
    0,
    "a reset leaves both select screens landing on their first row, so row 4 is " +
      "somewhere the shelf does not already land",
  );

  await openSelect(h, "extras");
  await h.debug.setSelectIndex(ENTERED_INDEX);
  await pressAction(h, "confirm");
  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "editor",
    "confirm on an Extras row opens that challenge in the editor, which is " +
      "entering it",
  );
  assertEqual(
    entered.challenge?.source,
    "extras",
    "the challenge entered is the shelf's own",
  );
  assertEqual(
    entered.challenge?.index,
    ENTERED_INDEX,
    `and it is Extras challenge ${ENTERED_INDEX + 1}, ${EXTRA_NAMES[ENTERED_INDEX] ?? ""}`,
  );

  await pressAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "back while editing returns to the select screen the challenge was opened from",
  );

  await h.debug.setSelectIndex(DISPLACED_ROW);
  const displaced = await h.snapshot();
  assertEqual(
    displaced.selectIndex,
    DISPLACED_ROW,
    "the highlight is moved off the entered row before the shelf is left",
  );
  assertEqual(
    displaced.extras.last,
    ENTERED_INDEX,
    "moving the highlight is not entering a challenge, so the resting row is " +
      "still the one that was entered",
  );

  await pressAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "back on the select screen returns to the title",
  );

  await openSelect(h, "extras");
  await captureStill(h, "landed");

  const arrived = await h.snapshot();
  assertEqual(
    arrived.extras.last,
    ENTERED_INDEX,
    "the shelf's resting row is the challenge most recently entered",
  );
  assertNotEqual(
    arrived.selectIndex,
    DISPLACED_ROW,
    "returning does not simply leave the highlight where it was last moved to",
  );
  assertEqual(
    arrived.selectIndex,
    ENTERED_INDEX,
    "arriving at the shelf puts the highlight on the challenge last entered, row 4",
  );
});
