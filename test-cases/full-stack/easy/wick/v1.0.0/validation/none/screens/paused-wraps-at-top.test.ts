// screens/paused-wraps-at-top — `up` on the first pause item wraps the
// highlight to the last.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): "`menuIndex` is `0`
// on arriving. `up` and `down` move the highlight and wrap at both ends", over
// "the menu `PAUSE_ITEMS` ... `RESUME`, `MAIN MENU`, in that order", so the
// wrap from `0` lands on `PAUSE_ITEMS.length - 1`. specs/controls.md ("What
// each screen reads"), the `paused` row: "`up`, `down` move the highlight,
// wrapping".
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and paused with a REAL
// `KeyP`, which arrives on `0`, the item the wrap is stated from, and the index
// is read back before the press. The press is a REAL `ArrowUp` held across
// exactly one frame, and no other key is touched.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pressPause,
  pressUp,
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

it("wraps the pause menu highlight from the first item to the last", async () => {
  await night(h);
  const paused = await pressPause(h);
  assertEqual(paused.screen, "paused", "the screen the press is made on");
  assertEqual(paused.menuIndex, 0, "menuIndex before the press");

  const after = await pressUp(h);
  await captureStill(h, "wrap");

  assertHighlight(
    after,
    "paused",
    LAST,
    "after ArrowUp on the first pause item",
  );
});
