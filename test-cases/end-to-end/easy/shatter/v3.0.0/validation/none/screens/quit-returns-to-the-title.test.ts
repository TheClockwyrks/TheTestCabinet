// Shatter — screens/quit-returns-to-the-title: confirming the pause menu's third entry
// leaves the game for the title screen.
//
// THE RULE. `specs/ui.md` puts `QUIT TO MENU` third in `PAUSE_ITEMS` and says it
// "returns to `title`".
//
// THE ENTRY IS ADDRESSED, NOT COUNTED. `setMenuIndex(2)` places the highlight on the
// last entry directly; counting presses onto it would grade `controls/menu-down-arrow`
// a second time, and would also lean on the WRAP that `screens/menu-selection-stays-in-
// range` decides. The confirm key is a real one through Chromium's own input pipeline,
// because `specs/instrumentation.md` carries no operation that takes a menu entry.
// Which index `QUIT TO MENU` is, is `screens/pause-menu-entries`' requirement.
//
// THE GAME BEHIND IT IS A REAL ONE, opened through the harness's own `startPlaying` and
// paused, so what this entry is asked to leave is a live run rather than a posed screen
// with nothing behind it.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the title's highlight comes back to its first
// entry — `specs/ui.md` states it, and no item in this case reads it — nor what the
// other two pause entries do, nor that `Escape` on the pause menu resumes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { confirmEntry, reachPaused } from "./screens";

/** The pause menu's third entry, `QUIT TO MENU` (`specs/ui.md`). */
const QUIT_ENTRY = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when QUIT TO MENU is confirmed", async () => {
  assertEqual(
    PAUSE_ITEMS[QUIT_ENTRY],
    "QUIT TO MENU",
    "the pause menu's third entry, which specs/ui.md fixes",
  );

  await startPlaying(h);
  await reachPaused(h);
  await confirmEntry(h, QUIT_ENTRY);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen QUIT TO MENU returned to (specs/ui.md)",
  );
});
