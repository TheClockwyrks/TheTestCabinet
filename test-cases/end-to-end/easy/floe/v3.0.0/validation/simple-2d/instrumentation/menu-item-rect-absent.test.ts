// Floe — instrumentation/menu-item-rect-absent: the region read answers `null`
// wherever the specification says there is no region to report.
//
// `specs/instrumentation.md` fixes both places: `menuItemRect(index)` is `null`
// "on `howto` and `playing`, which show no menu, and when `index` names no item
// of the menu the current screen shows".
//
// THE POSITIVE HALF IS ITS OWN POINT. That a region exists for every item of
// every menu, of real extent, inside the stage and sharing no point with its
// neighbours, is `instrumentation.menu-item-rect`. The two fail independently: a
// build can lay every menu out correctly and still answer a rectangle for
// `menuItemRect(-1)`, which is a pointer landing on an entry that is not there.
//
// BOTH OUT-OF-RANGE ENDS ARE READ, on each of the four menus: one past the last
// entry, and `-1`. A build that clamps its index rather than rejecting it fails
// one end or the other rather than neither.
//
// THE STILL IS THE HOW-TO SCREEN, the menuless screen a player actually reaches,
// so what stands beside the verdict is the screen the read was taken on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { ENDING_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** Each menu screen and the entries `specs/ui.md` gives it. */
const MENUS = [
  { screen: "title", items: TITLE_ITEMS },
  { screen: "paused", items: PAUSE_ITEMS },
  { screen: "victory", items: ENDING_ITEMS },
  { screen: "gameover", items: ENDING_ITEMS },
] as const;

/** The two screens that show no menu at all (`specs/ui.md`). */
const MENULESS = ["howto", "playing"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports no region where the specification says there is none", () => {
  h.debug.reset();

  for (const menu of MENUS) {
    h.debug.setScreen(menu.screen);
    assertEqual(
      h.snapshot().screen,
      menu.screen,
      `the pose opened the ${menu.screen} screen`,
    );

    assertNull(
      h.debug.menuItemRect(menu.items.length),
      `menuItemRect(${menu.items.length}) on ${menu.screen}, one past its last ` +
        "entry (specs/instrumentation.md)",
    );
    assertNull(
      h.debug.menuItemRect(-1),
      `menuItemRect(-1) on ${menu.screen}, an index no menu has ` +
        "(specs/instrumentation.md)",
    );
  }

  for (const screen of MENULESS) {
    h.debug.setScreen(screen);
    assertNull(
      h.debug.menuItemRect(0),
      `menuItemRect(0) on ${screen}, which shows no menu (specs/ui.md)`,
    );
  }

  // The how-to screen is the menuless screen a player reaches from a menu, so
  // it is the one the reviewer is handed.
  h.debug.setScreen("howto");
  captureStill(h, "no-menu");
});
