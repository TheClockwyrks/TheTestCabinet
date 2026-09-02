// Floe — screens/pause-quit: confirming QUIT TO MENU leaves the run for the title
// screen.
//
// `specs/ui.md`, the `paused` row of the transitions table: "Confirm — ... `QUIT
// TO MENU` returns to `title`." This point decides the third of the pause menu's
// three entries, and only that: the screen the confirm landed on.
//
// THE THREE ENTRIES ARE THREE POINTS. A build can wire RESUME and RESTART and
// leave the way back to the title dead, and a player who took it would be stuck
// inside a run for good. `screens.pause-resume` and `screens.pause-restart` grade
// the other two, each posing its own index, so a single dead entry costs a single
// point and the failure names which entry it was.
//
// THE HIGHLIGHT IS POSED, THE CONFIRM IS A REAL KEY. `setMenuIndex` puts the
// highlight on the entry this transition is about, because walking it down with
// the down key would make the point fail for a build whose menu keys are broken —
// that is `controls.menu-down`, and it is graded there. The confirm itself is
// dispatched at the event target the engine listens on, so the engine's binding,
// its press-edge detection and the build's reading of the action are every step
// between the key and the screen it landed on.
//
// WHAT THE TITLE SCREEN THEN SHOWS is `screens.title-contents`, and that a fresh
// build opens on it is `screens.title-opens`. A build that returns to a title
// screen it draws nothing on keeps this point and loses those.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The pause entry this transition belongs to: `QUIT TO MENU`, the third. */
const QUIT_INDEX = 2;

/** One frame after the press, so the still shows the title rather than the menu. */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title screen when QUIT TO MENU is confirmed", async () => {
  startCrossing(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(QUIT_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    QUIT_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[QUIT_INDEX]}, the third entry`,
  );

  await h.tap("Enter");
  await h.advance(SETTLE_TICKS);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    `confirming ${PAUSE_ITEMS[QUIT_INDEX]} returns to the title (specs/ui.md)`,
  );
});
