// screens/title-wraps-at-top — the title highlight wraps past the top.
//
// WHAT THIS DECIDES. One edge case, in one direction: on `title` with the first
// item highlighted, one `up` press leaves the highlight on the LAST item rather
// than off the top of the menu or stuck where it was.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "`menuIndex` is `0` on arriving. `up` and `down`
//   move the highlight by one item and wrap at both ends"; the menu is
//   `TITLE_ITEMS`, so the last item's index is `TITLE_ITEMS.length − 1`.
//   specs/controls.md ("What each screen reads"): "`up`, `down` move the
//   highlight, wrapping at both ends".
//
// THE DRIVE. A reset to the title, which leaves the highlight on the first item
// with no key pressed at all, then the one `ArrowUp` this point is about.
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

it("wraps the title highlight from the first item to the last", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen ArrowUp is pressed on");
  assertEqual(before.menuIndex, 0, "the highlight before ArrowUp");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "title", "the screen ArrowUp left the game on");
  assertEqual(
    after.menuIndex,
    TITLE_ITEMS.length - 1,
    "the highlight after ArrowUp on the first item",
  );
});
