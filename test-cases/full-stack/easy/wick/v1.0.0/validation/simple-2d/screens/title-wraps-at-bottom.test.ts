// screens/title-wraps-at-bottom — the title highlight wraps past the bottom.
//
// WHAT THIS DECIDES. One edge case, in one direction: on `title` with the LAST
// item highlighted, one `down` press leaves the highlight on the first item
// rather than off the end of the menu or stuck where it was.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "`up` and `down` move the highlight by one item and
//   wrap at both ends"; the menu is `TITLE_ITEMS`, "`LIGHT THE LAMP`, `THE
//   ALMANAC`, `HOW TO PLAY`, in that order", so the last item's index is
//   `TITLE_ITEMS.length − 1`, which is `2`.
//   specs/controls.md ("What each screen reads"): "`title` | none | `up`,
//   `down` move the highlight, wrapping".
//
// THE DRIVE. A reset to the title, then `ArrowDown` pressed to the last item,
// asserted, then the press this point is about. The surface poses no
// `menuIndex`, so the last item is reached with the menu's own key.
//
// THE TOLERANCE. None: a menu index is exact.

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

it("wraps the title highlight from the last item to the first", async () => {
  h.reset();
  const last = TITLE_ITEMS.length - 1;
  let staged = h.snapshot();
  for (let press = 0; press < last; press += 1) {
    staged = await tap(h, "ArrowDown");
  }
  assertEqual(staged.screen, "title", "the screen ArrowDown is pressed on");
  assertEqual(staged.menuIndex, last, "the highlight on the last title item");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "title", "the screen ArrowDown left the game on");
  assertEqual(
    after.menuIndex,
    0,
    "the highlight after ArrowDown on the last item",
  );
});
