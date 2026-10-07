// screens/levelup-wraps-at-bottom — `down` on the last offer wraps the
// highlight to the first.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "`up` and `down`
// move the highlight and wrap at both ends". specs/progression.md
// ("Choosing"): "`up` and `down` move the highlight by one and wrap at both
// ends", over the offers the overlay lists, which are `OFFER_COUNT` (`3`) here
// — so the last index is `2` and the wrap lands on `0`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with three offers queued
// through `setNextOffers`, so the list the wrap runs off the end of is the one
// this check posed rather than a draw of the build's. The surface carries no
// pose for `menuIndex`, so the last offer is reached by pressing `ArrowDown`
// once per offer below the first, with the index read back before the wrapping
// press. Each press is a REAL key held across exactly one frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
import { assertHighlight, night, openOffers } from "./stage";

/** Three candidates of an empty loadout's pool. */
const OFFERS = ["ember", "pin", "wick"] as const;

/** The index of the last offer listed. */
const LAST = OFFERS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the overlay highlight from the last offer to the first", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  let posed = opened;
  for (let i = 0; i < LAST; i += 1) posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    LAST,
    "menuIndex on the last offer before the press",
  );

  const after = await pressDown(h);
  await captureStill(h, "wrap");

  assertHighlight(after, "levelup", 0, "after ArrowDown on the last offer");
});
