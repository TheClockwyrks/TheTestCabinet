// screens/game-over-menu-returns-to-the-play-entry — leaving a finished run by its
// menu entry puts the title's highlight back on the entry that started the match.
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
import { GAMEOVER_ITEMS, TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, keyFor, type Harness } from "../harness";

/** The entry `specs/ui.md` fixes as the game-over menu's second. */
const MENU = 1;

/** The title entry that leads away into a match (`specs/ui.md`). */
const PLAY_ENTRY = 0;

/** The run the game-over screen carries: a score, no ships, a wave reached. */
const POSED_SCORE = 4260;
const POSED_WAVE = 13;
const NO_SHIPS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("comes back to the PLAY entry the match was started from", async () => {
  assertEqual(
    GAMEOVER_ITEMS[MENU],
    "MENU",
    "the second entry of the game-over menu specs/ui.md fixes",
  );
  assertEqual(
    TITLE_ITEMS[PLAY_ENTRY],
    "PLAY",
    "the title entry specs/ui.md puts first",
  );

  h.debug.reset();
  h.debug.setScreen("gameover");
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setLives(NO_SHIPS);
  h.debug.setMenuIndex(MENU);

  const over = h.snapshot();
  assertEqual(over.screen, "gameover", "the screen the entry was taken from");
  assertEqual(over.menuIndex, MENU, "the entry the highlight was posed on");

  await h.tap(keyFor("confirm"));
  captureStill(h, "title");

  assertEqual(
    h.snapshot().menuIndex,
    PLAY_ENTRY,
    "the title entry highlighted on the return from the game-over menu " +
      "(specs/ui.md)",
  );
});
