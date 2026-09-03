// screens/levelup-down-moves-highlight — `down` moves the overlay's highlight
// one offer down.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "`menuIndex` is
// `0` on opening. `up` and `down` move the highlight and wrap at both ends".
// specs/progression.md ("Choosing"): "`up` and `down` move the highlight by one
// and wrap at both ends". specs/controls.md ("What each screen reads"), the
// `levelup` row: "`up`, `down` move the highlight, wrapping at both ends", read
// as press edges.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with three offers queued
// through `setNextOffers` and opened by the tick that ends with a level-up
// queued, which is the real route onto the overlay. The index is read back
// before the press so that a build that opened on something other than `0`
// fails on the precondition. The press is a REAL `ArrowDown` through Chromium's
// input pipeline held across exactly one frame, and the overlay ticks nothing,
// so the frame changes nothing but the highlight.
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the overlay highlight from 0 to 1 on ArrowDown", async () => {
  await night(h);
  const opened = await openOffers(h, OFFERS);
  assertEqual(opened.menuIndex, 0, "menuIndex before the press");

  const after = await pressDown(h);
  await captureStill(h, "down");

  assertHighlight(after, "levelup", 1, "after ArrowDown on the overlay");
});
