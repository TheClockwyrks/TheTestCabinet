// Wick — screens/levelup-wraps-at-top: `up` on the first offer wraps the
// highlight to the last.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`":
// "`menuIndex` is `0` on opening. `up` and `down` move the highlight and wrap
// at both ends". `specs/progression.md`, "The draw", puts `OFFER_COUNT` (`3`)
// offers on the overlay when the pool holds at least that many, so an `up`
// from `0` reads `2`.
//
// THE DRIVE. An isolated `playing` run holding nothing, whose pool is every
// base weapon and every passive; the overlay opened by one `playing` tick,
// which arrives on index `0`; and one real `ArrowUp`. Nothing is pressed
// first, so the wrap is the only thing the reading can be about.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";

/** The last offer's index on a full overlay (specs/progression.md, The draw). */
const LAST_OFFER = OFFER_COUNT - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the last offer after ArrowUp on the first", async () => {
  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the press is made on");
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers on the overlay");
  assertEqual(overlay.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "levelup", "the screen after the wrapping press");
  assertEqual(
    after.menuIndex,
    LAST_OFFER,
    "menuIndex after ArrowUp past the top",
  );
});
