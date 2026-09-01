// screens/levelup-wraps-at-top — `up` on the first offer wraps the highlight to
// the last.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "`menuIndex` is
// `0` on opening. `up` and `down` move the highlight and wrap at both ends".
// specs/progression.md ("Choosing"): "`up` and `down` move the highlight by one
// and wrap at both ends", over the offers the overlay lists, which are
// `OFFER_COUNT` (`3`) here — so the wrap from `0` lands on `2`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with three offers queued
// through `setNextOffers`, so the list the wrap runs off the front of is the
// one this check posed. The overlay opens on `0`, which is the offer the wrap
// is stated from, and the index is read back before the press. The press is a
// REAL `ArrowUp` held across exactly one frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, pressUp, type Harness } from "../harness";
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

it("wraps the overlay highlight from the first offer to the last", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(opened.menuIndex, 0, "menuIndex before the press");

  const after = await pressUp(h);
  await captureStill(h, "wrap");

  assertHighlight(after, "levelup", LAST, "after ArrowUp on the first offer");
});
