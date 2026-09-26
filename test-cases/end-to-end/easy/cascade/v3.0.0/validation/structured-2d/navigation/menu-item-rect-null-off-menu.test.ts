// navigation/menu-item-rect-null-off-menu — the read answers `null` where the
// specification says there is no item.
//
// THE RULE. `specs/instrumentation.md`, The core: `menuItemRect` "returns `null`
// on `won`, which shows no menu, and when `index` names no item of the menu the
// current screen shows."
//
// WHY IT IS ITS OWN POINT. It is the read's answer where there is NOTHING to
// report, which is a different requirement from reporting a region that is there.
// A build that lays every menu out correctly and answers a rectangle one past the
// end must grade differently from one whose read answers nothing at all.
//
// THE CAP IS `great`. Both answers are read by tooling rather than by a player:
// the game plays identically whichever way a build answers an index that names no
// item, and `won` shows no menu to press.
//
// BOTH `null` ANSWERS ARE HERE because they are the same requirement stated for
// two cases — an index off the end of a menu that exists, and a screen that shows
// no menu at all — and a check drives both the same way.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTable,
  openTitle,
  openWon,
  type Harness,
  type MenuRect,
} from "../harness";

/** The three menus `specs/controls.md` gives a screen, and how to reach each. */
const MENUS: readonly {
  screen: string;
  items: number;
  open: (h: Harness) => void;
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
let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("answers null one past each menu's end, and on the screen with no menu", async () => {
  for (const menu of MENUS) {
    await menu.open(h);
    assertEqual(
      h.snapshot().screen,
      menu.screen,
      `posing: the screen this menu belongs to`,
    );

    const past = h.debug.menuItemRect(menu.items);
    assertEqual(
      past,
      null,
      `menuItemRect(${menu.items}) on the ${menu.screen} screen, which names ` +
        `no item of a menu of ${menu.items} — it returns null when index ` +
        `names no item of the menu the current screen shows ` +
        `(specs/instrumentation.md); reported ${show(past)}`,
    );
  }

  openWon(h);
  const onWon = h.debug.menuItemRect(0);

  openTitle(h);
  await h.advance(1);
  // Before the assertion, so a read that answered a region still leaves the
  // picture of a menu that does have one.
  captureStill(h, "regions");

  assertEqual(
    onWon,
    null,
    `menuItemRect(0) on the won screen, which shows no menu ` +
      `(specs/instrumentation.md, specs/screens.md) — reported ${show(onWon)}`,
  );
});
