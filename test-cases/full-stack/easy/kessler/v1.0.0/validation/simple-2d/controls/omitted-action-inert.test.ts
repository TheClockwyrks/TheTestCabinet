// controls/omitted-action-inert — an action a screen omits does nothing there.
//
// specs/controls.md's screen table gives `title` only "`up` and `down` move
// the highlight; `confirm` accepts it", and rules that "an action a row omits
// does nothing on that screen". `pause` (`KeyP`) is one the title's row
// omits, so KeyP on the title leaves the game on `title` with the menu
// unchanged — exactly the reading the review item names.
//
// The title is opened by resetting, so the highlight rests on entry `0` and
// the only thing that could have moved anything is the one omitted-action
// press. Both readings the press could have disturbed — the screen and the
// highlight — are read back unchanged.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";

/** The omitted action's key: `pause`, which `title`'s row does not read. */
const KEY = KEYS.pause[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the title untouched by KeyP", async () => {
  assertEqual(KEY, "KeyP", "the binding this point presses");
  h.reset();
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the screen the key is pressed on");
  assertEqual(opened.menu.index, 0, "the highlight before the press");

  await tap(h, KEY);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen after KeyP, which title's row omits",
  );
  assertEqual(after.menu.index, 0, "the highlight after KeyP");
});
