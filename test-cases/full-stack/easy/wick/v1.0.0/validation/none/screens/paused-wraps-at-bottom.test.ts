// screens/paused-wraps-at-bottom — `down` on the last pause item wraps the
// highlight to the first.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): "`up` and `down`
// move the highlight and wrap at both ends", over "the menu `PAUSE_ITEMS` ...
// `RESUME`, `MAIN MENU`, in that order" — two items, so the last index is
// `PAUSE_ITEMS.length - 1` and the wrap lands on `0`. specs/controls.md ("What
// each screen reads"), the `paused` row: "`up`, `down` move the highlight,
// wrapping".
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and paused with a REAL
// `KeyP`, and the surface carries no pose for `menuIndex`, so the last item is
// reached by pressing `ArrowDown` from the `0` the screen is arrived on, once
// per item below the first, and the index is read back before the wrapping
// press so that a build whose `down` never reached the last item fails on the
// precondition rather than on the wrap. Each press is a REAL key held across
// exactly one frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pressDown,
  pressPause,
  type Harness,
} from "../harness";
import { assertHighlight, night } from "./stage";

/** The index of the last item of `PAUSE_ITEMS`. */
const LAST = PAUSE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the pause menu highlight from the last item to the first", async () => {
  await night(h);
  let posed = await pressPause(h);
  assertEqual(posed.screen, "paused", "the screen the press is made on");
  for (let i = 0; i < LAST; i += 1) posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    LAST,
    "menuIndex on the last item before the press",
  );

  const after = await pressDown(h);
  await captureStill(h, "wrap");

  assertHighlight(after, "paused", 0, "after ArrowDown on the last pause item");
});
