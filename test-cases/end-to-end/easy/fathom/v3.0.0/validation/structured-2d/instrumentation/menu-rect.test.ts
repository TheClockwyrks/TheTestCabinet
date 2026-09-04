// instrumentation/menu-rect — the surface reports where each menu item was drawn.
//
// specs/ui.md leaves a menu's layout to the build — "Each menu item occupies a
// rectangular hit region the build lays out" — and specs/instrumentation.md makes
// the build report it: `menuItemRect(index)` "returns `{ x, y, w, h }` in logical
// units, with `x` and `y` the region's top-left corner and `w` and `h` its size:
// the region a pointer selects item `index` from ... It returns `null` on
// `"howto"`, `"countdown"`, `"playing"` and `"cleared"`, which show no menu, and
// when `index` names no item of the menu the current screen shows."
//
// THIS READING IS WHAT STANDS BETWEEN A PLAYER ON A MOUSE OR A PHONE AND A GAME
// THEY CANNOT START. The six `pointer` and `touch` points drive the region it
// reports and nothing else, so a build that reports a region it did not draw menus
// a pointer can never reach — and every one of those six fails for a reason none
// of them can name. This point names it.
//
// WHAT IS ASSERTED OF A REGION, AND WHAT IS NOT. That it lies inside the stage,
// that it CONTAINS the point that item's own text was drawn at, and that it
// overlaps no other region of the same menu. Not that the text FITS inside it: a
// region is a hit target rather than a bounding box, and a build that draws a wide
// heading over a narrow target has laid its menu out in a way specs/ui.md permits.
// Containment of the anchor is the property that makes a gesture aimed at the
// middle of the region land on the item a player sees there, which is the whole of
// what the six points downstream depend on.
//
// THE ANCHOR IS THE POINT THE BUILD DREW AT, read through the transform in force
// at the call (`text.ts`), so a build that translates to a menu's corner and draws
// at the origin is placed where it actually drew rather than at `(0, 0)`. A build
// that draws an item's words as several runs — a marker beside the word, a
// letter-spaced heading — is met by taking the runs that name the item and asking
// that at least one of them was drawn inside the region.
//
// ALL THREE MENUS ARE READ, because each is laid out separately and a build that
// reports the title's geometry correctly may report the pause menu's from the
// title's table.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertTrue } from "../assert";
import {
  GAMEOVER_ITEMS,
  PAUSE_ITEMS,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import type { MenuRect, Screen } from "../surface";
import { textDraws } from "../text";
import { frameOps } from "../states/screens";

/** The three menus specs/ui.md gives, each on the screen that shows it. */
const MENUS = [
  { screen: "title" as Screen, items: TITLE_ITEMS },
  { screen: "paused" as Screen, items: PAUSE_ITEMS },
  { screen: "gameover" as Screen, items: GAMEOVER_ITEMS },
];

/** The four screens specs/state.md says show no menu at all. */
const MENULESS: readonly Screen[] = [
  "howto",
  "countdown",
  "playing",
  "cleared",
];

/** Whether `(x, y)` lies inside `rect`, its edges included. */
function contains(rect: MenuRect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/** Whether two regions share any area at all. */
function overlaps(a: MenuRect, b: MenuRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a region for every menu item, and nothing for every other index", async () => {
  startPlaying(h);

  for (const menu of MENUS) {
    h.debug.setScreen(menu.screen);
    assertEqual(
      h.snapshot().screen,
      menu.screen,
      `the screen the ${menu.screen} menu is read on`,
    );

    const drawn = textDraws(await frameOps(h));
    if (menu.screen === "title") {
      // Before the assertions, so a failing check still leaves a picture of the
      // menu whose geometry is being read.
      captureStill(h, "regions");
    }

    const regions: MenuRect[] = [];
    for (const [index, item] of menu.items.entries()) {
      const rect = h.debug.menuItemRect(index);
      assertTrue(
        rect !== null,
        `menuItemRect(${String(index)}) reports a region for ${item} on the ` +
          `${menu.screen} menu (specs/instrumentation.md)`,
      );
      if (rect === null) continue;
      regions.push(rect);

      assertTrue(
        rect.w > 0 && rect.h > 0,
        `the region reported for ${item} on the ${menu.screen} menu has a ` +
          `size, rather than the ${String(rect.w)} x ${String(rect.h)} it ` +
          "reported (specs/instrumentation.md)",
      );
      assertTrue(
        rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.w <= STAGE_W &&
          rect.y + rect.h <= STAGE_H,
        `the region reported for ${item} on the ${menu.screen} menu lies ` +
          `inside the ${String(STAGE_W)} x ${String(STAGE_H)} stage, rather ` +
          `than at (${String(rect.x)}, ${String(rect.y)}) ` +
          `${String(rect.w)} x ${String(rect.h)} (specs/overview.md)`,
      );

      const runs = drawn.filter((run) =>
        run.text.toUpperCase().includes(item.toUpperCase()),
      );
      assertTrue(
        runs.length > 0,
        `the ${menu.screen} menu drew ${item} somewhere on the frame, which is ` +
          "what its reported region has to contain (specs/ui.md)",
      );
      assertTrue(
        runs.some((run) => contains(rect, run.x, run.y)),
        `the region reported for ${item} on the ${menu.screen} menu contains ` +
          "the point that item's own text was drawn at — it reported " +
          `(${String(rect.x)}, ${String(rect.y)}) ${String(rect.w)} x ` +
          `${String(rect.h)} and the text was drawn at ` +
          `${runs.map((run) => `(${run.x.toFixed(1)}, ${run.y.toFixed(1)})`).join(" ")}`,
      );
    }

    for (let a = 0; a < regions.length; a += 1) {
      for (let b = a + 1; b < regions.length; b += 1) {
        assertEqual(
          overlaps(regions[a], regions[b]),
          false,
          `whether the regions reported for ${menu.items[a]} and ` +
            `${menu.items[b]} on the ${menu.screen} menu overlap, which two ` +
            "hit targets on one menu may not (specs/ui.md)",
        );
      }
    }

    assertEqual(
      h.debug.menuItemRect(menu.items.length),
      null,
      `menuItemRect(${String(menu.items.length)}) on the ${menu.screen} menu, ` +
        "which holds no such item (specs/instrumentation.md)",
    );
  }

  for (const screen of MENULESS) {
    h.debug.setScreen(screen);
    assertEqual(
      h.debug.menuItemRect(0),
      null,
      `menuItemRect(0) on ${screen}, which shows no menu ` +
        "(specs/instrumentation.md)",
    );
  }
});
