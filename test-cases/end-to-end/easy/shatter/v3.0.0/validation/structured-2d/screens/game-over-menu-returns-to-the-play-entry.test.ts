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
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entry the highlight is posed on: `MENU`, the second. */
const MENU = 1;

/** The title entry that leads away into a match (`specs/ui.md`). */
const PLAY_ENTRY = 0;

/** The score the finished run ended on. */
const FINAL_SCORE = 4321;

/** The ships a finished run has left: none (specs/progression.md). */
const FINAL_LIVES = 0;

/** The quiet stretch driven on the game-over screen before the press, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

/** Frames driven after the press for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

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

  // The game-over screen a finished run leaves, with the highlight on MENU.
  resetTo(h);
  h.debug.setScreen("gameover");
  h.debug.setMenuIndex(MENU);
  h.debug.setScore(FINAL_SCORE);
  h.debug.setLives(FINAL_LIVES);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot().menuIndex;

  await h.advance(PICTURE_TICKS);
  captureStill(h, "title");

  assertEqual(
    before.menuIndex,
    MENU,
    "the highlighted entry the press was taken on, posed through " +
      "setMenuIndex (specs/instrumentation.md)",
  );
  assertEqual(
    after,
    PLAY_ENTRY,
    `the title entry highlighted after confirming ` +
      `${JSON.stringify(GAMEOVER_ITEMS[MENU])} — specs/ui.md returns to title ` +
      `with the highlight on ${JSON.stringify(TITLE_ITEMS[PLAY_ENTRY])}, the ` +
      "entry that led away into the match",
  );
});
