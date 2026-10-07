// screens/chest-up-inert — `up` does nothing on the chest overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`chest`"): "`up`, `down`,
// `back`, and `pause` do nothing here." specs/controls.md ("What each screen
// reads"), the `chest` row: "`confirm` closes the overlay; `mute`", and "An
// action a row omits does nothing on that screen." specs/ui.md ("Menu
// navigation"): "`menuIndex` is `0` on entering every screen but `title` ...
// and on a screen with no menu it stays `0`." The other arrow is
// `screens/chest-down-inert`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an empty loadout, so
// the chest falls through to the heal and the overlay carries no list at all,
// and the chest is reached the real way. One REAL key held across exactly one
// frame, with the screen and the index read after it.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, pressUp, type Harness } from "../harness";
import { assertHighlight, night, openHealChest } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the chest overlay with menuIndex 0 under ArrowUp", async () => {
  await night(h);
  const opened = await openHealChest(h);
  assertEqual(
    opened.menuIndex,
    0,
    "menuIndex on arriving at the chest overlay",
  );

  const after = await pressUp(h);
  await captureStill(h, "inert");

  assertHighlight(after, "chest", 0, "after ArrowUp on the chest overlay");
});
