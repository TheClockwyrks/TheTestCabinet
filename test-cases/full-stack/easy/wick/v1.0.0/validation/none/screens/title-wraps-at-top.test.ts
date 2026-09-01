// screens/title-wraps-at-top — `up` on the first title item wraps the highlight
// to the last.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`"): "`menuIndex` is `0`
// on arriving. `up` and `down` move the highlight by one item and wrap at both
// ends", over `TITLE_ITEMS`, "`LIGHT THE LAMP`, `HOW TO PLAY`, in that order",
// so the wrap from `0` lands on `TITLE_ITEMS.length - 1`.
// specs/controls.md ("What each screen reads"), the `title` row: "`up`, `down`
// move the highlight, wrapping at both ends".
//
// WHY THE WORLD IS POSED AS IT IS. Nothing is posed: the screen is entered on
// `0`, which is the item the wrap is stated from, and the index is read back
// before the press. The press is a REAL `ArrowUp` held across exactly one
// frame, and no other key is touched.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, pressUp, type Harness } from "../harness";
import { assertHighlight } from "./stage";

/** The index of the last item of `TITLE_ITEMS`. */
const LAST = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the title highlight from the first item to the last", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  assertEqual(title.menuIndex, 0, "menuIndex before the press");

  const after = await pressUp(h);
  await captureStill(h, "wrap");

  assertHighlight(
    after,
    "title",
    LAST,
    "after ArrowUp on the first title item",
  );
});
