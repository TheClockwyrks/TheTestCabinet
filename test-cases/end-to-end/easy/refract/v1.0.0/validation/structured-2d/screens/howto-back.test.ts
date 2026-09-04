// Refract — screens/howto-back: back on the how-to screen returns to the title
// with menuIndex 0.
//
// One transition of the menu state machine specs/ui.md fixes: on `howto`,
// `back` returns to `title` with `menuIndex = 0`. The how-to screen is reached
// the way a player does — down twice to HOW TO PLAY, then confirm — and the
// arrival is asserted before the press under test, so a build that never
// reaches how-to fails on the precondition it breaks, not on the return.
// Every press is the action's own bound key, dispatched as a real key event at
// the target the engine listens on (menus are keyboard only, specs/ui.md).
// The still is the title the back press returned to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns from the how-to screen to the title at menuIndex 0", async () => {
  await resetTo(h);
  assertEqual(TITLE_ITEMS[2], "HOW TO PLAY");
  await tapAction(h, "down");
  await tapAction(h, "down");
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "howto", "the how-to screen is up");

  await tapAction(h, "back");
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title", "back returns to the title");
  assertEqual(h.snapshot().menuIndex, 0, "the title is back at menuIndex 0");
});
