// Wick — instrumentation/menu-rects-reported: `menuRects()` reports one
// rectangle per item of the menu the screen is showing, in menu order, each
// carrying `x`, `y`, `width` and `height` in stage coordinates, on `title`,
// `levelup`, `paused`, `fallen` and `dawn`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `menuRects()`):
// "Reports the rectangles of the current screen's vertical menu, in menu order,
// each a plain object carrying `x`, `y`, `width`, and `height` in stage
// coordinates, `0` to `STAGE_W` across and `0` to `STAGE_H` down, which are the
// coordinates the pointer is read in. `title`, `levelup`, `paused`, `fallen`,
// and `dawn` report one rectangle per item of the menu they show", and "Each
// rectangle is the area a hover or a click selects that item inside, so what
// this reading reports is what the pointer rules of `specs/controls.md` act
// on." The counts are the menus themselves: `TITLE_ITEMS` is three items,
// `PAUSE_ITEMS` two, `END_ITEMS` two (specs/ui.md), and `levelup` shows the
// offers the overlay opened with, which the snapshot reports.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. Two things per screen: how many
// rectangles came back, and which item each position belongs to. The second is
// read the only way the specification defines it — "the rectangle at position
// `i` belongs to the item at `menuIndex` `i`" (specs/controls.md), and a hover
// inside it "sets `menuIndex` to `i`" — so the pointer is rested in each
// rectangle in turn and `menuIndex` is read back. Nothing about where a
// rectangle sits on the stage is read: specs/ui.md fixes "no layout".
//
// WHY THE WORLD IS POSED AS IT IS. Each screen is entered by its own route: the
// title is where a reset leaves the game, the overlay is opened by the tick that
// opens it, and `paused`, `fallen` and `dawn` are entered through their
// `setScreen` rows. The rectangles are visited in the order `1, 2, ... , 0`, so
// every hover moves the highlight off the item it stood on and a reading that
// reported one rectangle over and over cannot pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  END_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
  type ScreenName,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  menuRects,
  openLevelUp,
  poseScreen,
  type Harness,
} from "../harness";
import { assertBelongsTo, assertRects, movingOrder } from "./rects";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The screen reports `count` rectangles, each carrying the four documented
 * numbers, and the rectangle at each position belongs to that item of the menu.
 */
async function requireMenu(screen: ScreenName, count: number): Promise<void> {
  const rects = await menuRects(h);
  assertLength(rects, count, `menuRects() on ${screen}`);
  assertRects(rects, `menuRects() on ${screen}`);
  for (const position of movingOrder(count)) {
    await assertBelongsTo(
      h,
      rects,
      position,
      position,
      `the item menuRects()[${position}] on ${screen} belongs to`,
    );
  }
}

it("reports one rectangle per menu item, in menu order", async () => {
  // title, where the reset leaves the game, with the three `TITLE_ITEMS`.
  await h.debug.reset();
  await requireMenu("title", TITLE_ITEMS.length);

  // levelup, opened by the tick that opens it, with the offers it drew.
  await isolate(h);
  const levelup = await openLevelUp(h);
  assertEqual(
    levelup.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertTrue(levelup.run.offers.length > 0, "the overlay opening with offers");
  await requireMenu("levelup", levelup.run.offers.length);

  // paused, with the two `PAUSE_ITEMS`.
  await isolate(h);
  await poseScreen(h, "paused");
  await requireMenu("paused", PAUSE_ITEMS.length);

  // fallen and dawn, each with the two `END_ITEMS`.
  await isolate(h);
  await poseScreen(h, "fallen");
  await requireMenu("fallen", END_ITEMS.length);

  await isolate(h);
  await poseScreen(h, "dawn");
  await requireMenu("dawn", END_ITEMS.length);
  await captureStill(h, "rects");
});
