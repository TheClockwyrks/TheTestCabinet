// Floe — screens/gameover-menu: MENU on the game-over screen returns to the
// title.
//
// `specs/ui.md`, the `victory`, `gameover` row of the transitions table:
// "Confirm — `PLAY AGAIN` starts a fresh run and opens `playing`; `MENU` returns
// to `title`." This point decides the second of those two entries on the
// game-over screen, and only that: the screen the confirm landed on.
//
// THIS IS THE GAME-OVER SCREEN'S OWN POINT. `screens.victory-menu` grades the
// same entry on the other end screen. A build commonly writes one end screen and
// copies it, and a copy that kept the other screen's handler is exactly the
// defect these two items tell apart, so each poses its own screen and neither
// passes through the other's on the way.
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
// nothing at all stays on `gameover`: two different wrong answers, each named by
// what the screen reads afterwards.
//
// THE RUN IS POSED AS A LOST ONE — six levels in, out of lives — so the screen
// this confirm is given is the screen a player reaches.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseEnding } from "./screens";

/** The ending entry this transition belongs to: `MENU`, the second. */
const MENU_INDEX = 1;

/** The lost run the screen reports. */
const REACHED_LEVEL = 6;
const LIVES = 0;

/** One tick after the press, so the still shows the title rather than the screen. */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when MENU is confirmed on the game-over screen", async () => {
  await poseEnding(h, "gameover", REACHED_LEVEL);
  await h.debug.setReachedLevel(REACHED_LEVEL);
  await h.debug.setLives(LIVES);
  await h.debug.setMenuIndex(MENU_INDEX);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "gameover", "the pose opened the game-over screen");
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
    `confirming ${ENDING_ITEMS[MENU_INDEX]} on the game-over screen returns ` +
      `to the title (specs/ui.md)`,
  );
});
