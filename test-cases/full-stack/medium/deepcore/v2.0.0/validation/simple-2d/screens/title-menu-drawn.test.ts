// screens/title-menu-drawn — the title screen draws the main menu.
//
// specs/ui.md: the `title` screen shows "The title `TITLE_TEXT` (`DEEPCORE`), a
// tagline, and the main menu", and the main menu with no save banked is
// `NEW EXPEDITION` and `HOW TO PLAY`.
//
// WHICH ENTRIES THE MENU HAS, and what each one selects, is
// `screens/title-menu-items`. This point decides only that the entries are DRAWN,
// so a build whose menu is wired correctly and never rendered fails here and
// passes there.
//
// FOUR POINTS, NOT ONE. specs/ui.md names four things about this screen — that
// the game is on it and it carries the title, that it carries a tagline, that it
// carries the main menu, and that the highlighted entry is drawn distinctly — and
// a build that gets three of them right must grade differently from one that gets
// none. The other three are `screens/title-screen-tagline`,
// `screens/title-menu-drawn` and `screens/title-menu-highlight-is-distinct`.
//
// ISOLATION. A fresh harness reset to its resting state with the save slot
// cleared, so the menu is the one specs/ui.md lists with no save banked and
// nothing on the screen belongs to an expedition.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";

/** The main menu with no save banked: `TITLE_ITEMS` without its first entry. */
const ITEMS = TITLE_ITEMS.slice(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every entry of the main menu", async () => {
  h.debug.clearSave();
  h.debug.reset();

  const calls = await h.frameCalls();
  captureStill(h, "menu");

  for (const item of ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `specs/ui.md: the title screen draws ${item}`,
    );
  }
});
