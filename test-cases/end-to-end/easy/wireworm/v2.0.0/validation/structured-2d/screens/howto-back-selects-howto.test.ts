// Wireworm — screens/howto-back-selects-howto: leaving the how-to screen lands
// on HOW TO PLAY.
//
// specs/ui.md's `howto` screen: "`back` returns to `title`, with the title's
// highlight on `HOW TO PLAY`". A return selects the entry that led away from the
// menu, so a player who checked the instructions comes back to the entry they
// left through rather than to the top of the list.
//
// `screens/howto-back` DECIDES THE TRANSITION and this decides the selection.
// They are separate points because a build that returns to the title on the
// wrong entry still returns, and must grade differently from one that cannot
// leave the screen at all.
//
// THE INDEX IS DERIVED FROM `TITLE_ITEMS`, never written as a literal: what
// specs/ui.md fixes is the ENTRY, and the position it sits at is a fact of the
// menu's order. A build that reordered nothing lands on `1`, and the check says
// why.
//
// THE HIGHLIGHT IS POSED AWAY FROM THAT ENTRY FIRST, onto `DESCEND`, so what is
// read back is what the return did rather than what `reset` had already left
// behind. The screen itself is posed with `setScreen`, so a build that cannot
// open the how-to screen fails `screens/title-howto` rather than this twice
// over, and the back press is the `back` action's own bound key through the
// build's own input.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The entry the how-to screen was opened from (specs/ui.md, `TITLE_ITEMS`). */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The entry the highlight is parked on first, so the return has to move it. */
const DESCEND_ITEM = TITLE_ITEMS.indexOf("DESCEND");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title with HOW TO PLAY selected", async () => {
  resetTo(h);
  // The highlight is parked while the TITLE is still current, whose menu the
  // index names, and the how-to screen is opened after it — the order
  // `screens.howto-back` already poses this scenario in. `howto` shows no menu
  // (specs/ui.md), and what this point is about is the title entry the return
  // selects, not what an index means on a screen showing no menu.
  h.debug.setMenuIndex(DESCEND_ITEM);
  h.debug.setScreen("howto");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "setScreen poses the how-to screen (specs/instrumentation.md)",
  );

  await tapAction(h, "back");
  await h.advance(1);
  captureStill(h, "title");

  const returned = h.snapshot();
  assertEqual(
    returned.screen,
    "title",
    "back on the how-to screen returns to the title (specs/ui.md)",
  );
  assertEqual(
    returned.menuIndex,
    HOWTO_ITEM,
    "the title entry the return selects (specs/ui.md)",
  );
});
