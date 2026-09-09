// Floe — pointer/paused-click-confirms:
// a press and its release inside one item's region confirm that item, on the
// pause menu.
//
// `specs/ui.md` drives ALL FOUR of this game's menus with a pointer — "All four
// menus are driven this way: `TITLE_ITEMS` on `title`, `PAUSE_ITEMS` on
// `paused`, and `ENDING_ITEMS` on `victory` and on `gameover`" — so a build that
// answers the mouse on the title screen alone has honoured one of four. This
// point is the second menu, read for the pointer's confirm.
//
// THE TITLE'S OWN COPY IS `pointer/click-confirms`, and the two fail
// independently for the reason `pointer/paused-hover-selects` gives.
//
// THE ENTRY IS `QUIT TO MENU`, because what it does is loud: `specs/ui.md` has
// it return to `title`, so a confirm that did not happen leaves the pause menu
// standing and a confirm that reached the wrong entry resumes the crossing or
// starts a fresh run. The three outcomes are told apart by one reading.
//
// WHAT IS NOT GRADED HERE. What `QUIT TO MENU` does is `screens.pause-quit`,
// including the entry it leaves selected on the title. This point is that a
// press and its release inside the region confirmed it at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  mousePress,
  mouseRelease,
  rectCenter,
  startCrossing,
  type Harness,
} from "../harness";

/** The entry the pose highlights: `RESUME`, the first of the three. */
const RESUME_ITEM = 0;

/** The entry the gesture aims at: `QUIT TO MENU`, the third. */
const QUIT_ITEM = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms the pause-menu item a press and its release both fall in", async () => {
  await startCrossing(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(RESUME_ITEM);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    RESUME_ITEM,
    `the pose highlighted ${PAUSE_ITEMS[RESUME_ITEM]}, the first of the three`,
  );

  const target = rectCenter(await menuRect(h, QUIT_ITEM));
  await mousePress(h, target.x, target.y);
  await mouseRelease(h);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    `a press and release inside ${PAUSE_ITEMS[QUIT_ITEM]}'s region confirm it, ` +
      "and confirming it returns to the title (specs/ui.md)",
  );
});
