// screens/title-wraps-at-bottom — `down` on the last title item wraps the
// highlight to the first.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`"): "`up` and `down`
// move the highlight by one item and wrap at both ends", over `TITLE_ITEMS`,
// "`LIGHT THE LAMP`, `THE ALMANAC`, `HOW TO PLAY`, in that order", so the last
// index is `TITLE_ITEMS.length - 1` and the wrap lands on `0`.
// specs/controls.md ("What each screen reads"), the `title` row: "`up`, `down`
// move the highlight, wrapping".
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no pose for `menuIndex`,
// so the last item is reached by pressing `ArrowDown` from the `0` the screen
// is entered on, once per item below the first, and the index is read back
// before the wrapping press so that a build whose `down` never reached the last
// item fails on the precondition rather than on the wrap. Each press is a REAL
// key held across exactly one frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
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

it("wraps the title highlight from the last item to the first", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  let posed = title;
  for (let i = 0; i < LAST; i += 1) posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    LAST,
    "menuIndex on the last item before the press",
  );

  const after = await pressDown(h);
  await captureStill(h, "wrap");

  assertHighlight(after, "title", 0, "after ArrowDown on the last title item");
});
