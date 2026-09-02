// Wick — screens/levelup-wraps-at-bottom: `down` on the last offer wraps the
// highlight to the first.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`": "`up`
// and `down` move the highlight and wrap at both ends".
// `specs/progression.md`, "The draw", puts `OFFER_COUNT` (`3`) offers on the
// overlay when the pool holds at least that many, so the last index is `2` and
// a `down` there reads `0`.
//
// THE DRIVE. An isolated `playing` run holding nothing, whose pool is every
// base weapon and every passive; the overlay opened by one `playing` tick;
// two real `ArrowDown` presses onto the last offer, read back as the
// precondition; then the `ArrowDown` that must wrap. The edge case is its own
// point: a build that moves the highlight correctly and clamps at the bottom
// fails here alone.
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

it("reads menuIndex 0 after ArrowDown on the last offer", async () => {
  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers on the overlay");

  let posed = overlay;
  for (let step = 0; step < LAST_OFFER; step += 1) {
    posed = await tap(h, "ArrowDown");
  }
  assertEqual(posed.screen, "levelup", "the screen the press is made on");
  assertEqual(posed.menuIndex, LAST_OFFER, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "levelup", "the screen after the wrapping press");
  assertEqual(after.menuIndex, 0, "menuIndex after ArrowDown past the bottom");
});
