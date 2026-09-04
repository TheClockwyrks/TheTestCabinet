// Shatter — screens/game-over-menu-returns-to-the-title: confirming the game-over
// screen's second entry returns to the title.
//
// THE RULE. `specs/ui.md` puts `MENU` second in `GAMEOVER_ITEMS` and says it "returns to
// `title`".
//
// THE ENTRY IS ADDRESSED, NOT COUNTED. `setMenuIndex(1)` places the highlight directly;
// counting presses onto it would grade `controls/menu-down-arrow` a second time. The
// confirm key is a real one through Chromium's own input pipeline, because
// `specs/instrumentation.md` carries no operation that takes a menu entry.
//
// THE RUN BEHIND THE SCREEN IS A FINISHED ONE — `470` points and `0` ships, what
// `specs/progression.md` leaves when the last ship is lost — so the screen this entry is
// asked to leave is the real one rather than a posed screen over an opening run.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the title's highlight comes back to its first
// entry — `specs/ui.md` states it, and no item in this case reads it — nor what the first
// entry does (`screens/play-again-starts-a-game`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GAMEOVER_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { confirmEntry, reachGameOver } from "./screens";

/** The game-over menu's second entry, `MENU` (`specs/ui.md`). */
const MENU_ENTRY = 1;

/** The score the finished run ended on. */
const FINAL_SCORE = 470;
/** The wave it reached. */
const FINAL_WAVE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when MENU is confirmed on the game-over screen", async () => {
  assertEqual(
    GAMEOVER_ITEMS[MENU_ENTRY],
    "MENU",
    "the game-over menu's second entry, which specs/ui.md fixes",
  );

  await reachGameOver(h, { score: FINAL_SCORE, wave: FINAL_WAVE });
  await confirmEntry(h, MENU_ENTRY);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen MENU returned to (specs/ui.md)",
  );
});
