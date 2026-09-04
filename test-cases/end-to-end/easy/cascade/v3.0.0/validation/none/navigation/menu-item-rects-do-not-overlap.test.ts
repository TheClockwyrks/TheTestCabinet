// navigation/menu-item-rects-do-not-overlap — no two regions of one screen's
// menu share any area.
//
// THE RULE. `specs/controls.md`, The controls: "A control answers only on the
// screen it belongs to, and the regions on one screen do not overlap each other,
// so a point lies in at most one of them."
//
// WHY IT IS ITS OWN POINT. `navigation/menu-item-rect-reported` decides that a
// region is reported at all; this decides that the reported regions are laid out
// so a press resolves to one item. A build can answer the first perfectly and
// still stack two items on top of each other, and the two misses cost a player
// different things, so they grade separately.
//
// THE CAP IS `passable`. A player can still reach every screen: the selection is
// still moved and still confirmed, and only a press in the shared area picks an
// item the player did not aim at.
//
// WHAT IS NOT ASSERTED. Where a region is, or how big: `specs/controls.md` leaves
// the layout to the build. Only the relationship BETWEEN one screen's regions is
// fixed, so only that is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HUD_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTable,
  openTitle,
  type Harness,
  type MenuRect,
} from "../harness";

/** The three menus `specs/controls.md` gives a screen, and how to reach each. */
const MENUS: readonly {
  screen: string;
  items: number;
  open: (h: Harness) => Promise<void>;
}[] = [
  { screen: "title", items: TITLE_ITEMS.length, open: openTitle },
  { screen: "howto", items: 1, open: openHowto },
  { screen: "playing", items: HUD_ITEMS.length, open: openTable },
];

/** How a region reads in a failure message. */
function show(rect: MenuRect | null): string {
  return rect === null
    ? "null"
    : `{ x: ${rect.x}, y: ${rect.y}, w: ${rect.w}, h: ${rect.h} }`;
}
/** Whether two regions share any area. */
function overlap(a: MenuRect, b: MenuRect): boolean {
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

it("lays out each screen's menu so no two of its regions overlap", async () => {
  for (const menu of MENUS) {
    await menu.open(h);
    assertEqual(
      (await h.snapshot()).screen,
      menu.screen,
      `posing: the screen this menu belongs to`,
    );

    const regions: MenuRect[] = [];
    for (let index = 0; index < menu.items; index += 1) {
      const rect = await h.debug.menuItemRect(index);
      assertTrue(
        rect !== null,
        `menuItemRect(${index}) on the ${menu.screen} screen to report the ` +
          `region this point compares against — a menu whose regions cannot ` +
          `be read cannot be laid out without overlap ` +
          `(specs/instrumentation.md)`,
      );
      if (rect !== null) regions.push(rect);
    }

    for (let a = 0; a < regions.length; a += 1) {
      for (let b = a + 1; b < regions.length; b += 1) {
        assertEqual(
          overlap(regions[a], regions[b]),
          false,
          `whether the regions the ${menu.screen} screen reports for items ` +
            `${a} and ${b} share any area — the regions on one screen do not ` +
            `overlap each other, so a point lies in at most one of them ` +
            `(specs/controls.md); they are ${show(regions[a])} and ` +
            `${show(regions[b])}`,
        );
      }
    }
  }

  await openTable(h);
  await h.advance(1);
  await captureStill(h, "regions");
});
