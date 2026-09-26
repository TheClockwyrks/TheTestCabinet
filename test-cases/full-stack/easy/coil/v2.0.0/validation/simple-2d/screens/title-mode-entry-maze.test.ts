// screens/title-mode-entry-maze — the mode's entry heads the title menu.
//
// specs/ui.md gives `TITLE_ITEMS` two entries in a fixed order: "The mode's
// entry, then `HOW TO PLAY`", and specs/mode.md names this mode's entry
// `MODE_ITEM` (`MAZE`). Both halves are read: the entry is on the screen, and it
// sits ABOVE `HOW TO PLAY` — a menu whose first item is the how-to screen puts
// `confirm` on the wrong thing for a player who has just loaded the game and
// pressed it.
//
// The word is stated here rather than read off the build, and it is stated
// LITERALLY rather than taken from this project's mode table: this point is one
// of the three each mode states its own version of, so the entry it is about is
// the one specs/mode.md fixes for THIS mode.
//
// Order is read from where the two runs were anchored, mapped through whatever
// transform the build drew under, and `specs/controls.md` makes the highlight
// move UP and DOWN a menu, so the entries run down the screen. Everything else
// about how the menu looks is the build's.
//
// The title is reached by resetting rather than by pressing anything, so a build
// whose menus do not work still has this point decided on what it draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, fail } from "../assert";
import { drewText } from "../case-harness/text";
import { HOWTO_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";
import { topmostRunY } from "./copy";

/** `MODE_ITEM` for this mode, as specs/mode.md tables it. */
const MODE_ITEM = "MAZE";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the mode entry above HOW TO PLAY on the title menu", async () => {
  const title = openTitle(h);
  assertEqual(title.screen, "title", "the screen the frame is read from");

  const calls = await h.frameCalls();
  captureStill(h, "title");

  assertEqual(
    drewText(calls, MODE_ITEM),
    true,
    `the title menu drawing ${MODE_ITEM}`,
  );

  const entry = topmostRunY(calls, MODE_ITEM);
  const howto = topmostRunY(calls, HOWTO_ITEM);
  if (entry === null || howto === null) {
    fail(`the title menu drawing both ${MODE_ITEM} and ${HOWTO_ITEM}`, {
      [MODE_ITEM]: entry,
      [HOWTO_ITEM]: howto,
    });
  }
  assertLessThan(entry, howto, `${MODE_ITEM} anchored above ${HOWTO_ITEM}`);
});
