// Wireworm — screens/ending-menu: confirming MENU on an ending screen returns to
// the title.
//
// One transition of the menu state machine `specs/ui.md` fixes for both end
// screens: MENU "Returns to `title`".
//
// WHICH ENTRY THE RETURN SELECTS is `screens/ending-menu-selects-descend`'s
// point, not this one: a build that reaches the title on the wrong entry still
// reaches it, and the two have to grade apart.
//
// It is taken from `victory`, the screen a run reaches by winning;
// `screens/ending-play-again` takes its own transition from `gameover`, so the
// shared ENDING_ITEMS menu is decided on both screens across the two.
//
// The highlight is posed onto the second ending item with `setMenuIndex`, so
// what this decides is the transition rather than how a menu moves.
//
// The accept is the `confirm` action's own bound key, dispatched as a real key
// event at the target the engine listens on.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS, TOTAL_LEVELS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The won run MENU is taken from. */
const RUN_SCORE = 8460;
const RUN_LIVES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the second ending item", async () => {
  resetTo(h);
  h.debug.setScore(RUN_SCORE);
  h.debug.setLives(RUN_LIVES);
  h.debug.setLevel(TOTAL_LEVELS);
  h.debug.setReachedLevel(TOTAL_LEVELS);
  h.debug.setScreen("victory");
  assertEqual(ENDING_ITEMS[1], "MENU", "MENU is the second ending item");
  h.debug.setMenuIndex(1);
  const won = h.snapshot();
  assertEqual(won.screen, "victory", "the press is made on an ending screen");
  assertEqual(
    won.menuIndex,
    1,
    "the ending menu's highlight rests on MENU before the confirm",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(
    title.screen,
    "title",
    "confirming MENU leaves the game on the title (specs/ui.md)",
  );
});
