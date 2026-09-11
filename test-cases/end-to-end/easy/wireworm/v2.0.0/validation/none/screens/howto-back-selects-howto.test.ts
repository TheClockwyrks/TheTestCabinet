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
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { BACK_KEY, poseHowto } from "./screens";

/** The entry the how-to screen was opened from (specs/ui.md, `TITLE_ITEMS`). */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The entry the highlight is parked on first, so the return has to move it. */
const DESCEND_ITEM = TITLE_ITEMS.indexOf("DESCEND");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the title with HOW TO PLAY selected", async () => {
  await poseHowto(h, DESCEND_ITEM);

  await h.tap(BACK_KEY);
  await h.advance(1);
  await captureStill(h, "title");

  const returned = await h.snapshot();
  assertEqual(
    returned.screen,
    "title",
    "the screen the back binding returned to",
  );
  assertEqual(
    returned.menuIndex,
    HOWTO_ITEM,
    "the title entry the return selects (specs/ui.md)",
  );
});
