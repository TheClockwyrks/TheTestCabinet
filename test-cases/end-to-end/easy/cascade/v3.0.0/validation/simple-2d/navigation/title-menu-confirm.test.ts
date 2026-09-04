// navigation/title-menu-confirm — `menu-confirm` activates the item at
// `menuIndex` on the title.
//
// THE RULE. `specs/controls.md`, Menu navigation, the per-screen table: `title` /
// `menu-confirm` — "Activates the item at `menuIndex`, as `specs/screens.md`
// states." `specs/screens.md` gives the second item, `HOW TO PLAY`, its effect:
// "Moves to `howto`."
//
// THE SELECTION IS POSED TO THE SECOND ITEM, NOT THE FIRST, and that is what
// makes the reading mean anything. A build that always activates item `0` reaches
// `playing` with a fresh deal on it, which is a different screen from the `howto`
// this point requires — so a confirm that ignores the selection is caught rather
// than passing on a menu it never read.
//
// A KEY BOUND TO TWO CODES IS ONE POINT. `specs/controls.md` binds `menu-confirm`
// to `Enter` and `Space`: the two raise the same action and exercise the same
// rule the same way, so both are driven here from the same posed start and a
// build that bound only one of the pair fails.
//
// WHAT THIS DOES NOT DECIDE. What `HOW TO PLAY` does when a POINTER activates it,
// which is `screens/title-how-to-opens`'s and `pointer/pointer-click-confirms`'s,
// nor the selection the how-to screen leaves behind, which is
// `navigation/title-remembers-how-to`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MENU_CONFIRM_KEYS, TITLE_HOW_TO_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
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

it("activates the selected title item on either confirm key", async () => {
  const read: { code: string; screen: string }[] = [];
  for (const code of MENU_CONFIRM_KEYS) {
    // Each key is driven from the same posed start, so the second reading is not
    // of a screen the first one reached.
    openTitle(h);
    h.debug.setMenuIndex(TITLE_HOW_TO_ITEM);
    assertEqual(
      h.snapshot().menuIndex,
      TITLE_HOW_TO_ITEM,
      `posing: menuIndex before the press of ${code} — a confirm has nothing ` +
        `to activate until the selection is where this point put it`,
    );

    await pressKey(h, code);
    read.push({ code, screen: h.snapshot().screen });
  }

  await h.advance(1);
  // Before the assertions, so a confirm that reached the wrong screen still
  // leaves the picture of it.
  captureStill(h, "howto");

  for (const step of read) {
    assertEqual(
      step.screen,
      "howto",
      `the screen one press of ${step.code} reached from the title with ` +
        `menuIndex ${TITLE_HOW_TO_ITEM}, which selects HOW TO PLAY — the ` +
        `confirm activates the item at menuIndex (specs/controls.md), and ` +
        `that item moves to howto (specs/screens.md)`,
    );
  }
});
