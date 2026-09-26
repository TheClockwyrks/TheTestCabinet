// Wireworm — screens/ending-menu-selects-descend: leaving an end screen for the
// menu lands on DESCEND.
//
// specs/ui.md's ending menu: `MENU` "Returns to `title`, with the title's
// highlight on `DESCEND`". A return selects the entry that led away from the
// menu, and `DESCEND` is the entry a run is started from, so a player who
// finishes a run comes back to the entry they left through.
//
// `screens/ending-menu` DECIDES THE TRANSITION and this decides the selection.
// They are separate points because a build that reaches the title on the wrong
// entry still reaches it, and must grade differently from one that cannot leave
// the end screen at all.
//
// THE INDEX IS DERIVED FROM `TITLE_ITEMS`, never written as a literal: what
// specs/ui.md fixes is the ENTRY, and the position it sits at is a fact of the
// menu's order.
//
// THE HIGHLIGHT IS NOWHERE NEAR IT WHEN THE CONFIRM RUNS. `menuIndex` is the
// highlight of whichever menu the current screen shows (specs/state.md), so on
// an end screen it rests on `MENU`'s own index — the second entry of
// `ENDING_ITEMS`, not the first — and a build that simply left `menuIndex` alone
// across the transition would land the title's highlight on `HOW TO PLAY`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { CONFIRM_KEY, poseEnding } from "./screens";

/** Which entry of `ENDING_ITEMS` is `MENU`. */
const MENU_ITEM = ENDING_ITEMS.indexOf("MENU");

/** The title entry a run is started from, and so the one an ending returns to. */
const DESCEND_ITEM = TITLE_ITEMS.indexOf("DESCEND");

/** The lost run the title is returned to from. */
const POSED_SCORE = 4720;
const POSED_LEVEL = 9;
const POSED_LIVES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the title with DESCEND selected", async () => {
  await poseEnding(h, "gameover", {
    score: POSED_SCORE,
    lives: POSED_LIVES,
    level: POSED_LEVEL,
    reachedLevel: POSED_LEVEL,
    menuIndex: MENU_ITEM,
  });

  await h.tap(CONFIRM_KEY);
  await h.advance(1);
  await captureStill(h, "title");

  const returned = await h.snapshot();
  assertEqual(returned.screen, "title", "the screen MENU returned to");
  assertEqual(
    returned.menuIndex,
    DESCEND_ITEM,
    "the title entry the return selects (specs/ui.md)",
  );
});
