// Wireworm — controls/confirm-enter: Enter reaches the confirm action, and it acts
// on the item the highlight is on.
//
// specs/controls.md binds `confirm` to `Enter` and `Space`, says it "accepts the
// highlighted menu item", and reads it as a press edge, "once per press".
// specs/ui.md fixes what the title menu's items do: `TITLE_ITEMS` is `DESCEND`
// then `HOW TO PLAY`, and "`confirm` takes the highlighted item" — `HOW TO PLAY`
// "moves to `howto`".
//
// THE SECOND ITEM, NOT THE FIRST, and that choice is the point. A press that
// confirmed whatever the build felt like would be indistinguishable from a working
// `confirm` if the highlight sat on the item a build opens by default; posed on
// `HOW TO PLAY`, three wrong builds read as three different screens — one that
// ignores `Enter` stays on `title`, one that ignores the highlight and always
// takes the first item opens `playing`, and one that answers the key and the
// highlight opens `howto`. It is also the quieter of the two routes: `howto` is a
// screen, where `DESCEND` opens a whole run, and this point is about a key rather
// than about what a run is.
//
// WHAT IS LEFT TO ITS OWN POINT. That the first item opens a run is
// `screens.title-descend-starts`, that the second opens the how-to screen is
// `screens.title-howto`, and what that screen SAYS is `screens.howto-copy`. The
// one thing read here is that the key acted, and acted on the highlighted item.
//
// `Enter` AND `Space` ARE SEPARATE POINTS because a build can bind one and not the
// other, and `Space` carries a second action — specs/controls.md gives it the two
// fire actions as well — so a build that treats `Space` only as fire answers
// `Enter` and not `Space`. `controls.confirm-space` reads that half.
//
// THE WORLD IS THE TITLE MENU AND ITS INDEX. Nothing else is posed and nothing
// else is touched.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this point is about, the first of the two `confirm` is bound to. */
const KEY = "Enter";

/** The item the press is posed on: `HOW TO PLAY`, the second of `TITLE_ITEMS`. */
const HOWTO_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the highlighted title item when Enter is pressed", async () => {
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
    `the screen an Enter press opens with the highlight on item ${HOWTO_INDEX}, "${TITLE_ITEMS[HOWTO_INDEX]}"`,
  );
});
