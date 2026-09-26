// screens/dawn-wraps-at-top — `up` on the first dawn item wraps the
// highlight to the last.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"):
// "`menuIndex` is `0` on arriving. `up` and `down` move the highlight and wrap,
// and `confirm` takes the highlighted item", over "Menu | `END_ITEMS`: `TRY
// AGAIN`, `TITLE`, in that order." specs/controls.md ("What each screen
// reads"), the `fallen`, `dawn` row: "`up`, `down` move the highlight,
// wrapping at both ends", read as press edges.
// `END_ITEMS` holds two items, so the wrap from `0` lands on
// `END_ITEMS.length - 1`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night ended at dawn: specs/world.md ("Fallen and dawn") ends a run "at the end of a tick, after
// every other phase of that tick has been applied", at dawn when "`tick` equals
// `DAWN_TIME x TICK_HZ` (`36000`)",
// which this reaches through the clock posed to `MAX_POSED_TICK` (`35999`), the greatest `setTick`
// accepts, and the tick that reaches `36000`. The screen is arrived at on `0`, which is
// the item the wrap is stated from, and the index is read back before the
// press. The press is a REAL `ArrowUp` held across exactly one frame, and no
// other key is touched.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import { captureStill, createHarness, pressUp, type Harness } from "../harness";
import { assertHighlight, endDawn, night } from "./stage";

/** The index of the last item of `END_ITEMS`. */
const LAST = END_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the dawn menu highlight from the first item to the last", async () => {
  await night(h);
  const ended = await endDawn(h);
  assertEqual(ended.menuIndex, 0, "menuIndex before the press");

  const after = await pressUp(h);
  await captureStill(h, "wrap");

  assertHighlight(after, "dawn", LAST, "after ArrowUp on the first dawn item");
});
