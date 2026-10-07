// Shatter — screens/game-over-menu-returns-to-the-play-entry: leaving a finished
// run by its menu entry puts the title's highlight back on the entry that started
// the match.
//
// THE RULE. `specs/ui.md`, on `gameover`: `MENU` "Returns to `title`, with the
// title's highlight on `PLAY`, the entry that led away into the match", and on
// `title`: "The highlight rests on the first entry when the game opens and on every
// return from a game, where `PLAY` is the entry that led away". `TITLE_ITEMS` is
// `PLAY`, `HOW TO PLAY` in that order, so the entry is index `0`.
//
// WHY IT IS A POINT OF ITS OWN. `screens/game-over-menu-returns-to-the-title`
// decides the SCREEN. A build that lands on the title with the highlight left
// wherever the game-over menu had it must grade differently from one that gets both
// right, so the highlight is read here and nowhere else.
//
// AND THE READING IS NOT VACUOUS. The game-over menu's highlight is posed on entry
// `1`, `MENU`, so a build that carried its menu index across the transition reports
// `1` here rather than the `0` the specification asks for.
//
// THE ENTRY IS ADDRESSED, NOT COUNTED. `setMenuIndex(1)` places the highlight
// directly; counting presses onto it would grade `controls/menu-down-arrow` a
// second time. The confirm is a real key, because `specs/instrumentation.md`
// carries no operation that takes a menu entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GAMEOVER_ITEMS, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { SETTLE_TICKS, confirmEntry, reachGameOver } from "./screens";

/** The game-over menu's second entry, `MENU` (`specs/ui.md`). */
const MENU_ENTRY = 1;

/** The title entry that leads away into a match (`specs/ui.md`). */
const PLAY_ENTRY = 0;

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

it("comes back to the PLAY entry the match was started from", async () => {
  assertEqual(
    GAMEOVER_ITEMS[MENU_ENTRY],
    "MENU",
    "the game-over menu's second entry, which specs/ui.md fixes",
  );
  assertEqual(
    TITLE_ITEMS[PLAY_ENTRY],
    "PLAY",
    "the title entry specs/ui.md puts first",
  );

  await reachGameOver(h, { score: FINAL_SCORE, wave: FINAL_WAVE });
  await confirmEntry(h, MENU_ENTRY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).menuIndex,
    PLAY_ENTRY,
    "the title entry highlighted on the return from the game-over menu " +
      "(specs/ui.md)",
  );
});
