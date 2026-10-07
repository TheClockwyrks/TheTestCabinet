// screens/dawn-wraps-at-bottom — `down` on the last dawn item wraps the
// highlight to the first.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`fallen` and `dawn`"):
// "`menuIndex` is `0` on arriving. `up` and `down` move the highlight and wrap,
// and `confirm` takes the highlighted item", over "Menu | `END_ITEMS`: `TRY
// AGAIN`, `TITLE`, in that order." specs/controls.md ("What each screen
// reads"), the `fallen`, `dawn` row: "`up`, `down` move the highlight,
// wrapping at both ends", read as press edges.
// `END_ITEMS` holds two items, so the last index is `END_ITEMS.length - 1` and
// the wrap lands on `0`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night ended at dawn: specs/world.md ("Fallen and dawn") ends a run "at the end of a tick, after
// every other phase of that tick has been applied", at dawn when "`tick` equals
// `DAWN_TIME x TICK_HZ` (`36000`)",
// which this reaches through the clock posed to `MAX_POSED_TICK` (`35999`), the greatest `setTick`
// accepts, and the tick that reaches `36000`. The surface carries no pose for
// `menuIndex`, so the last item is reached by pressing `ArrowDown` once per
// item below the first, with the index read back before the wrapping press so
// that a build whose `down` never reached the last item fails on the
// precondition. Each press is a REAL key held across exactly one frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
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

it("wraps the dawn menu highlight from the last item to the first", async () => {
  await night(h);
  let posed = await endDawn(h);
  for (let i = 0; i < LAST; i += 1) posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    LAST,
    "menuIndex on the last item before the press",
  );

  const after = await pressDown(h);
  await captureStill(h, "wrap");

  assertHighlight(after, "dawn", 0, "after ArrowDown on the last dawn item");
});
