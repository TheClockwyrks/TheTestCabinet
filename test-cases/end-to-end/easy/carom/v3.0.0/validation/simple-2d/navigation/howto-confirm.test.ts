// Carom — navigation/howto-confirm: Enter on the how-to screen returns to the title.
//
// One transition of the menu state machine specs/ui.md fixes. It reaches the
// how-to screen through the title menu first. Every key is a real key event
// dispatched at the target the engine listens on, so the action is raised by
// the binding the case declares, and the result is read back off the game's own
// state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  menuIndex0,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns from the how-to screen to the title on Enter", async () => {
  assertEqual(TITLE_ITEMS[2], "HOW TO PLAY");
  h.debug.reset();
  await h.tap("ArrowDown"); // SOLO -> VERSUS
  await h.tap("ArrowDown"); // VERSUS -> HOW TO PLAY
  await h.tap("Enter");
  assertEqual(h.snapshot().screen, "howto");

  await h.tap("Enter");
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(menuIndex0(h), 0);
});
