// Carom — navigation/title-remembers-howto: the title comes back on HOW TO PLAY
// after the how-to screen.
//
// One requirement of the menu state machine specs/ui.md fixes, in one direction.
// "The remembered title selection" says confirming an item on the title menu sets
// `titleIndex` to that item's index, and "Returning to the title" says leaving the
// how-to screen restores `menuIndex` from `titleIndex`. So the round trip ends on
// the entry that opened it: `HOW TO PLAY`, the third of `TITLE_ITEMS`.
//
// BOTH HALVES ARE READ, because only the pair separates the requirement from a
// build that remembers nothing: `titleIndex` on the how-to screen is what the
// confirm stored, and `menuIndex` on the title is what the return restored. Both
// figures are `2`, and a fresh title carries `0` for both, so neither reading is
// one a build gets for free.
//
// Two real key events, and they are the two this point is about: the `Enter` that
// confirms the entry and the `Escape` that leaves the screen, each dispatched at
// the target the runtime listens on so the action is raised by the binding the
// case declares. The selection is put on `HOW TO PLAY` by `setMenuIndex` rather
// than pressed down to, because the movement edges are `navigation/title-down`'s
// point. `navigation/howto-back` grades the return itself over a how-to screen
// posed with nothing confirmed, and reads the `0` this point deliberately moves
// off.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` or on `howto` (specs/ui.md) and the reading is of neither a ball nor an
// obstacle, so there is no bystander to remove. No paddle is taken: a menu is not
// driven through one. The still is the frame the second press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

const HOWTO = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title on HOW TO PLAY", async () => {
  assertEqual(TITLE_ITEMS[HOWTO], "HOW TO PLAY");
  openTitle(h);
  h.debug.setMenuIndex(HOWTO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, HOWTO);
  assertEqual(posed.titleIndex, 0);

  await h.tap("Enter");
  const opened = h.snapshot();
  assertEqual(opened.screen, "howto");
  assertEqual(opened.titleIndex, HOWTO);

  await h.tap("Escape");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.titleIndex, HOWTO);
  assertEqual(title.menuIndex, HOWTO);
});
