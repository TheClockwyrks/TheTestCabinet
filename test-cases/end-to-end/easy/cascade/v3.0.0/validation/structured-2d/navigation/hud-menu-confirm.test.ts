// navigation/hud-menu-confirm — `menu-confirm` activates the HUD item at
// `menuIndex` during play.
//
// THE RULE. `specs/controls.md`, Menu navigation, the per-screen table: `playing`
// / `menu-confirm` — "Activates the HUD item at `menuIndex`, as
// `specs/screens.md` states." `specs/screens.md` gives the second item, `MENU`,
// its effect: "Returns to `title`."
//
// THE SELECTION IS POSED TO THE MIDDLE ITEM, and that is what makes the reading
// mean anything. The HUD's three items do three different things — a fresh deal,
// a return to the title, and the mute — so a build that always activates item `0`
// stays on `playing` with a dealt table, and one that always activates the last
// flips `muted` and stays. Both read as a different answer from the `title` this
// point requires.
//
// A KEY BOUND TO TWO CODES IS ONE POINT. `specs/controls.md` binds `menu-confirm`
// to `Enter` and `Space`: the two raise the same action and exercise the same
// rule the same way, so both are driven here from the same posed start.
//
// WHAT THIS DOES NOT DECIDE. What `MENU` does when a POINTER activates it, which
// is `screens/hud-menu-returns`'s, nor which entry the title comes back on, which
// is `navigation/title-remembers-new-game`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_MENU_ITEM, MENU_CONFIRM_KEYS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  pressKey,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("activates the selected HUD item on either confirm key", async () => {
  const read: { code: string; screen: string }[] = [];
  for (const code of MENU_CONFIRM_KEYS) {
    // Each key is driven from the same posed start, so the second reading is not
    // of a screen the first one reached.
    openTable(h);
    h.debug.setMenuIndex(HUD_MENU_ITEM);
    assertEqual(
      h.snapshot().menuIndex,
      HUD_MENU_ITEM,
      `posing: menuIndex before the press of ${code} — a confirm has nothing ` +
        `to activate until the selection is where this point put it`,
    );

    await pressKey(h, code);
    read.push({ code, screen: h.snapshot().screen });
  }

  await h.advance(1);
  captureStill(h, "title");

  for (const step of read) {
    assertEqual(
      step.screen,
      "title",
      `the screen one press of ${step.code} reached from play with menuIndex ` +
        `${HUD_MENU_ITEM}, which selects the HUD's MENU item — the confirm ` +
        `activates the HUD item at menuIndex (specs/controls.md), and that ` +
        `item returns to title (specs/screens.md)`,
    );
  }
});
