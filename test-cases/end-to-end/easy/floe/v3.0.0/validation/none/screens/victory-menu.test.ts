// Floe — screens/victory-menu: MENU on the victory screen returns to the title.
//
// `specs/ui.md`, the `victory`, `gameover` row of the transitions table:
// "Confirm — `PLAY AGAIN` starts a fresh run and opens `playing`; `MENU` returns
// to `title`." This point decides the second of those two entries on the victory
// screen, and only that: the screen the confirm landed on.
//
// FOUR OF THE FOUR END-SCREEN TRANSITIONS ARE FOUR POINTS. `PLAY AGAIN` and
// `MENU` are two transitions, and the victory screen and the game-over screen are
// two screens a build can get right on one and wrong on the other. A build whose
// victory `MENU` is dead — the state a player is left in after winning, with no
// way back to the title — must grade differently from one with all four entries
// broken, so each of the four poses its own screen and its own index.
//
// THE HIGHLIGHT IS POSED, THE CONFIRM IS A REAL KEY. `setMenuIndex` puts the
// highlight on the entry this transition is about, because moving it there with
// the down key would make the point fail for a build whose menu keys are broken —
// that is `controls.menu-down`, and it is graded there. The confirm goes through
// Chromium's own input pipeline, so what reaches the build is a browser-trusted
// DOM key event on the real page.
//
// THE SECOND ENTRY IS THE READING, NOT MERELY "NOT PLAYING". A build that ran
// `PLAY AGAIN`'s effect for both entries lands on `playing`, and a build that did
// nothing at all stays on `victory`: two different wrong answers, each named by
// what the screen reads afterwards.
//
// THE LEVEL IS POSED AT `TOTAL_LEVELS`, which is where `specs/progression.md`
// wins a run, so the screen this confirm is given is the screen a player reaches.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS, TOTAL_LEVELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseEnding } from "./screens";

/** The ending entry this transition belongs to: `MENU`, the second. */
const MENU_INDEX = 1;

/** One tick after the press, so the still shows the title rather than the screen. */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when MENU is confirmed on the victory screen", async () => {
  await poseEnding(h, "victory", TOTAL_LEVELS);
  await h.debug.setMenuIndex(MENU_INDEX);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "victory", "the pose opened the victory screen");
  assertEqual(
    posed.menuIndex,
    MENU_INDEX,
    `the pose highlighted ${ENDING_ITEMS[MENU_INDEX]}, the second entry`,
  );

  await h.tap("Enter");
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    `confirming ${ENDING_ITEMS[MENU_INDEX]} on the victory screen returns to ` +
      `the title (specs/ui.md)`,
  );
});
