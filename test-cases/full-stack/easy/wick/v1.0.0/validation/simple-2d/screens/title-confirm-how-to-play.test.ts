// screens/title-confirm-how-to-play — HOW TO PLAY opens the how-to screen.
//
// WHAT THIS DECIDES. One thing: `confirm` on the title's second item leaves the
// game on `howto` with `menuIndex` 0.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "`HOW TO PLAY` | Sets `screen = howto` and
//   `menuIndex = 0`", with `TITLE_ITEMS` "`LIGHT THE LAMP`, `HOW TO PLAY`, in
//   that order".
//   specs/controls.md ("Actions and bindings"): `confirm` is `Enter`, `Space`.
//
// THE DRIVE. A reset to the title, then `ArrowDown` to bring the highlight onto
// `HOW TO PLAY` and the precondition asserted, then the `Enter` this point is
// about. The surface poses no `menuIndex`, so the menu's own key is the only
// way to the second item.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters howto when the HOW TO PLAY item is confirmed", async () => {
  h.reset();
  const wanted = TITLE_ITEMS.indexOf("HOW TO PLAY");
  let staged = h.snapshot();
  for (let press = 0; press < wanted; press += 1) {
    staged = await tap(h, "ArrowDown");
  }
  assertEqual(staged.screen, "title", "the screen Enter is pressed on");
  assertEqual(staged.menuIndex, wanted, "the highlight resting on HOW TO PLAY");

  const after = await tap(h, "Enter");
  captureStill(h, "howto");

  assertEqual(after.screen, "howto", "the screen Enter left the game on");
  assertEqual(after.menuIndex, 0, "the highlight on arriving at howto");
});
