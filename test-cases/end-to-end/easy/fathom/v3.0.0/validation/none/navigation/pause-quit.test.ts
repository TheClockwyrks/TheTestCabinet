// navigation/pause-quit — QUIT TO MENU on the pause menu returns to the title.
//
// specs/ui.md's transition table: `"paused"` + `QUIT TO MENU` confirmed ->
// `"title"`. This point decides that one edge and nothing else — WHAT the return
// restores is `navigation/title-resets-the-dive`, and WHICH entry the title comes
// back on is `navigation/title-remembers-dive`.
//
// THE SELECTION IS POSED, NEVER WALKED. `setMenuIndex` puts the highlight on
// `QUIT TO MENU` (specs/instrumentation.md) and one `confirm` takes it, so a
// build with a broken `down` action fails `controls` and passes this. The pause
// menu itself is reached through `setScreen`, because opening it is
// `controls.pause-esc`'s point.
//
// Nothing advances on `"paused"` (specs/ui.md), so no bystander can move under
// the scenario and none is posed away.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The pause menu's entries, by index (specs/ui.md, `PAUSE_ITEMS`). */
const QUIT = PAUSE_ITEMS.indexOf("QUIT TO MENU");

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when QUIT TO MENU is confirmed", async () => {
  await startPlaying(h);
  // The board is emptied of hunters: what this decides is a screen, and a
  // release that came early would end the dive under the reading
  // (specs/instrumentation.md).
  await h.debug.clearPredators();
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(QUIT);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the selection is posed on");
  assertEqual(posed.menuIndex, QUIT, "the posed pause-menu selection");

  await h.tap(CONFIRM_KEY);
  // Before the assertion, so a failing check still leaves the screen it read.
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen QUIT TO MENU confirmed on the pause menu reaches (specs/ui.md)",
  );
});
