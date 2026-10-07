// instrumentation/menu-item-rect-null-off-menu — no entry, no region.
//
// specs/instrumentation.md, `menuItemRect(index)`: "On a screen with no menu,
// and for an `index` outside the menu's entries, it returns `null`."
//
// TWO WAYS OF HAVING NO ENTRY, ONE EDGE CASE: a screen that carries no menu at
// all, and an index past the end (or before the start) of a menu that does.
// That a real entry reports a real region is `menu-item-rect-reports-regions`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import { captureStill, menuRect, openHarness, type Harness } from "../harness";
import { MENU_FREE_SCREENS } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("answers null off a menu and past a menu's entries", async () => {
  h.debug.reset();

  for (const screen of MENU_FREE_SCREENS) {
    h.debug.setScreen(screen);
    assertEqual(menuRect(h, 0), null, `${screen}: entry 0's region`);
  }

  for (const [screen, entries] of [
    ["title", TITLE_ITEMS],
    ["paused", PAUSE_ITEMS],
  ] as const) {
    h.debug.setScreen(screen);
    assertEqual(
      menuRect(h, entries.length),
      null,
      `${screen}: the region one past the last entry`,
    );
    assertEqual(menuRect(h, -1), null, `${screen}: entry -1's region`);
  }
  captureStill(h, "no-menu");
});
