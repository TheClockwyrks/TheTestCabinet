// Wick — screens/levelup-up-moves-highlight: `up` moves the overlay's
// highlight to the offer above.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`": "`up`
// and `down` move the highlight and wrap at both ends".
// `specs/controls.md` binds `up` to `ArrowUp` and `KeyW`. From `menuIndex`
// `1` a move up is a move by one offer, to `0`, with no wrap involved.
//
// THE DRIVE. An isolated `playing` run holding nothing, one level-up posed
// pending and the tick that opens the overlay, one `ArrowDown` to stand on the
// second offer, read back as the precondition, then the `ArrowUp` this point
// is about. The debug surface carries no operation that poses `menuIndex`
// (`specs/instrumentation.md`), so the overlay's own `down` is the only way
// onto the second offer.
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 after ArrowUp from the second offer", async () => {
  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers on the overlay");

  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.screen, "levelup", "the screen the press is made on");
  assertEqual(posed.menuIndex, 1, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "levelup", "the screen after ArrowUp");
  assertEqual(after.menuIndex, 0, "menuIndex after one ArrowUp");
});
