// Carom — navigation/title-howto: confirming HOW TO PLAY opens the how-to
// screen.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction.
// The selection is put on the `HOW TO PLAY` entry by `setMenuIndex`, which is the
// precondition this point names; pressing down to it twice would fail this point
// for a broken down edge, which is `navigation/title-down`'s to report.
//
// What the how-to screen then SHOWS is `ui/state-howto`'s point. What is read
// here is the transition alone: `screen` becomes `howto`, and specs/ui.md fixes
// `menuIndex` at `0` on arrival, the index of the single item that screen shows.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` or on `howto` (specs/ui.md) and the reading is of neither a ball nor an
// obstacle, so there is no bystander to remove. No paddle is taken: a menu is not
// driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

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

it("opens the how-to screen from the third title item", async () => {
  assertEqual(TITLE_ITEMS[HOWTO], "HOW TO PLAY");
  openTitle(h);
  h.debug.setMenuIndex(HOWTO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, HOWTO);

  await h.tap("Enter");
  captureStill(h, "howto");

  const opened = h.snapshot();
  assertEqual(opened.screen, "howto");
  assertEqual(opened.menuIndex, 0);
});
