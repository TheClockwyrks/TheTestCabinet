// instrumentation/menu-rects-reported — `menuRects()` reports one rectangle per
// item of the menu the screen shows, in menu order, each carrying x, y, width,
// and height in stage coordinates, on title, levelup, paused, fallen, and dawn.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, Menus: "Reports the
// rectangles of the current screen's vertical menu, in menu order, each a plain
// object carrying `x`, `y`, `width`, and `height` in stage coordinates, `0` to
// `STAGE_W` across and `0` to `STAGE_H` down, which are the coordinates the
// pointer is read in. `title`, `levelup`, `paused`, `fallen`, and `dawn` report
// one rectangle per item of the menu they show." specs/controls.md, The
// pointer: "Each item the menu currently shows occupies a rectangle on the
// stage, and no two of a screen's rectangles overlap."
//
// HOW MANY ITEMS EACH MENU SHOWS comes from specs/ui.md alone: the title menu
// is `TITLE_ITEMS`, the pause menu is `PAUSE_ITEMS`, the two end screens carry
// `END_ITEMS`, and the level-up overlay shows "the offers in `offers`", read
// off the snapshot rather than assumed, since a build's overlay reports what it
// drew.
//
// MENU ORDER is read as the order the menu stacks its items down the stage,
// which is what specs/ui.md fixes for each of these five screens: the title
// menu's "items are stacked one above the next", the overlay's offers are
// "listed vertically in that order", and the pause and end menus name their
// items "in that order". Nothing here fixes WHERE a build puts a menu, only
// that item i is reported above item i + 1 and that the rectangles are on the
// stage and disjoint. Which item a rectangle then answers for the pointer is a
// pointer point.
//
// THE DRIVE. Each screen is reached through the surface alone, so a build whose
// menus cannot be walked still answers for what the reading reports.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { END_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  type Harness,
  type Screen,
} from "../harness";
import { assertRects, assertStackedDownward } from "./rects";
import { SCREEN_ROUTES } from "./helpers";

/**
 * The screens that show a menu, and how many items each shows. `levelup`
 * answers `null`: its count is `offers.length`, read off the snapshot on the
 * screen itself.
 */
const MENUS: Readonly<Partial<Record<Screen, number | null>>> = {
  title: TITLE_ITEMS.length,
  levelup: null,
  paused: PAUSE_ITEMS.length,
  fallen: END_ITEMS.length,
  dawn: END_ITEMS.length,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports one rectangle per menu item, in menu order, on every menu screen", async () => {
  for (const [screen, reach] of SCREEN_ROUTES) {
    const declared = MENUS[screen];
    if (declared === undefined) continue;

    await reach(h);
    const s = h.snapshot();
    assertEqual(s.screen, screen, `the ${screen} screen, reached`);

    const expected = declared ?? s.run.offers.length;
    assertGreaterThan(expected, 0, `the items ${screen} shows`);

    const rects = menuRects(h);
    assertRects(rects, expected, `menuRects() on ${screen}`);
    assertStackedDownward(rects, `menuRects() on ${screen}`);
  }

  await h.tick(1);
  captureStill(h, "rects");
});
