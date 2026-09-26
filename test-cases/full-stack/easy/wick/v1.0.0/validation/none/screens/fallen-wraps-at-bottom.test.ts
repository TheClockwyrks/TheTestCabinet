// screens/fallen-wraps-at-bottom — `down` on the last fallen item wraps the
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
// WHY THE WORLD IS POSED AS IT IS. An isolated night ended at fallen: specs/world.md ("Fallen and dawn") ends a run "at the end of a tick, after
// every other phase of that tick has been applied", fallen when "`hp` is `0`
// or below",
// which this reaches through the health posed to `0` through `setHp`, whose "value at or below
// `0` ends the run fallen at the end of the next `playing` tick"
// (specs/instrumentation.md), and the tick that ends it. The surface carries no pose for
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
import { assertHighlight, endFallen, night } from "./stage";

/** The index of the last item of `END_ITEMS`. */
const LAST = END_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the fallen menu highlight from the last item to the first", async () => {
  await night(h);
  let posed = await endFallen(h);
  for (let i = 0; i < LAST; i += 1) posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    LAST,
    "menuIndex on the last item before the press",
  );

  const after = await pressDown(h);
  await captureStill(h, "wrap");

  assertHighlight(
    after,
    "fallen",
    0,
    "after ArrowDown on the last fallen item",
  );
});
