// screens/levelup-up-moves-highlight — `up` moves the overlay's highlight one
// offer up.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`levelup`"): "`up` and `down`
// move the highlight and wrap at both ends". specs/progression.md
// ("Choosing"): "`up` and `down` move the highlight by one and wrap at both
// ends". specs/controls.md ("What each screen reads"), the `levelup` row:
// "`up`, `down` move the highlight, wrapping at both ends".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with three offers queued
// and the overlay opened the real way. The surface carries no pose for
// `menuIndex`, so the second offer is reached the only way it can be: one
// `ArrowDown`, with the index read back before the `ArrowUp` so that a build
// whose `down` is broken fails on the precondition rather than passing on a
// press that wrapped from `0`. Each press is a REAL key held across exactly one
// frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  pressUp,
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

it("moves the overlay highlight from 1 to 0 on ArrowUp", async () => {
  await night(h);
  await openOffers(h, OFFERS);
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    1,
    "menuIndex before the press, posed by one ArrowDown",
  );

  const after = await pressUp(h);
  await captureStill(h, "up");

  assertHighlight(after, "levelup", 0, "after ArrowUp on the overlay");
});
