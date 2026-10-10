// Carom — navigation/title-remembers-howto: the title comes back on HOW TO PLAY
// after the how-to screen.
//
// One requirement specs/ui.md fixes, in one direction. "The remembered title
// selection" says confirming an item on the title menu sets `titleIndex` to that
// item's index; "Returning to the title" says leaving the how-to screen restores
// `menuIndex` from `titleIndex`. So the round trip ends on the entry that opened
// it: HOW TO PLAY, the third of TITLE_ITEMS.
//
// Both halves are read, because only the pair separates this requirement from a
// build that remembers nothing: `titleIndex` on the how-to screen is what the
// confirm stored, and `menuIndex` on the title is what the return restored. Both
// figures are 2, and a fresh title carries 0 for both, so neither reading is one a
// build gets for free.
//
// The selection is posed onto HOW TO PLAY with `setMenuIndex` instead of pressed
// down to — the arrow edges are navigation/title-down's point — and the two keys
// pressed are the two this point is about: the Enter that confirms the entry and
// the Escape that leaves the screen. Each is a real key event dispatched at the
// target the engine listens on, so the action is raised by the binding the case
// declares, and the result is read back off the game's own state.
// navigation/howto-back grades the return itself over a how-to screen posed with
// nothing confirmed, and reads the 0 this point deliberately moves off.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title and nothing on the how-to screen, so no ball and no obstacle can move
// under this round trip. Neither paddle is taken from the player: this check
// presses menu keys alone. The still is the frame the second press left.

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
  await openTitle(h);
  h.debug.setMenuIndex(HOWTO);
  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, HOWTO);
  assertEqual(h.snapshot().titleIndex, 0);

  await h.tap("Enter");
  assertEqual(h.snapshot().screen, "howto");
  assertEqual(h.snapshot().titleIndex, HOWTO);

  await h.tap("Escape");
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(title.screen, "title");
  assertEqual(title.titleIndex, HOWTO);
  assertEqual(title.menuIndex, HOWTO);
});
