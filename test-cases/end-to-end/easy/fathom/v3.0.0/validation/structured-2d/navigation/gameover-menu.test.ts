// navigation/gameover-menu — MENU on the game-over screen returns to the title.
//
// specs/ui.md's transition table: `"gameover"` + `MENU` confirmed -> `"title"`.
// One edge, decided in one direction. What ENDS a run is `scoring.three-lives`,
// what the game-over screen DRAWS is `states.gameover-menu-items`, and what the
// return to the title restores is `navigation.title-resets-the-dive`.
//
// THE SELECTION IS POSED, NEVER WALKED. `setMenuIndex` puts the highlight on
// `MENU` (specs/instrumentation.md) and one `confirm` takes it, so a build with a
// broken `down` action fails `controls` and passes this. The screen itself is
// reached through `setScreen` rather than by spending three lives, because
// reaching it is another point's and a longer route only adds failure modes.
//
// Nothing advances on `"gameover"` (specs/ui.md), so no bystander can move under
// the press and none is posed away.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, GAMEOVER_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The game-over menu's entries, by index (specs/ui.md, `GAMEOVER_ITEMS`). */
const MENU = GAMEOVER_ITEMS.indexOf("MENU");

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when MENU is confirmed", async () => {
  startPlaying(h);
  h.debug.setScreen("gameover");
  h.debug.setMenuIndex(MENU);

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the screen the selection is posed on");
  assertEqual(posed.menuIndex, MENU, "the posed game-over selection");

  await h.tap(CONFIRM_KEY);
  // Before the assertion, so a failing check still leaves the screen it read.
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen MENU confirmed on the game-over screen reaches (specs/ui.md)",
  );
});
