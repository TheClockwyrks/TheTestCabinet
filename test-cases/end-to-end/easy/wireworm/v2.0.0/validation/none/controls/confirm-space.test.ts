// Wireworm — controls/confirm-space: Space reaches the confirm action on a menu
// screen, and it acts on the item the highlight is on.
//
// specs/controls.md binds `confirm` to `Enter` and `Space`, says it "accepts the
// highlighted menu item", and reads it as a press edge, "once per press".
// specs/ui.md fixes what the title menu's items do: `TITLE_ITEMS` is `DESCEND`
// then `HOW TO PLAY`, and "`confirm` takes the highlighted item" — `HOW TO PLAY`
// "moves to `howto`".
//
// SPACE IS THE KEY THAT CARRIES THREE ACTIONS. specs/controls.md binds it to both
// fire actions AND to `confirm`, and settles the ambiguity by screen: "`Space`
// fires while the game is being played and confirms on a screen showing a menu".
// This point is the confirm half, read from the title menu, where the
// specification says confirm is what it means; the fire half is
// `controls.space-fires`. A build that wired `Space` to the cursor's gun alone
// answers `Enter` on a menu and does nothing here, which is exactly the
// distinction the two confirm points exist to draw.
//
// THE SECOND ITEM, NOT THE FIRST, and that choice is the point. Posed on `HOW TO
// PLAY`, three wrong builds read as three different screens — one that ignores
// `Space` stays on `title`, one that ignores the highlight and always takes the
// first item opens `playing`, and one that answers the key and the highlight opens
// `howto`. It is also the quieter of the two routes: `howto` is a screen, where
// `DESCEND` opens a whole run, and this point is about a key.
//
// WHAT IS LEFT TO ITS OWN POINT. That the first item opens a run is
// `screens.title-descend-starts`, that the second opens the how-to screen is
// `screens.title-howto`, and what that screen SAYS is `screens.howto-copy`.
//
// THE WORLD IS THE TITLE MENU AND ITS INDEX. Nothing else is posed and nothing
// else is touched.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this point is about, the second of the two `confirm` is bound to. */
const KEY = "Space";

/** The item the press is posed on: `HOW TO PLAY`, the second of `TITLE_ITEMS`. */
const HOWTO_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the highlighted title item when Space is pressed", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(HOWTO_INDEX);
  await h.advance(1);

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "confirmed");

  assertEqual(
    after.screen,
    "howto",
    `the screen a Space press opens with the highlight on item ${HOWTO_INDEX}, "${TITLE_ITEMS[HOWTO_INDEX]}"`,
  );
});
