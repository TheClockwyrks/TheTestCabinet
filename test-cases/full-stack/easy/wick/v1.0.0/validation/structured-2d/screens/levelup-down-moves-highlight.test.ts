// Wick — screens/levelup-down-moves-highlight: `down` moves the overlay's
// highlight to the next offer.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`":
// "`menuIndex` is `0` on opening. `up` and `down` move the highlight and wrap
// at both ends". `specs/controls.md` gives the `levelup` row "`up`, `down`
// move the highlight, wrapping at both ends" and binds `down` to `ArrowDown`
// and `KeyS`. `specs/progression.md`, "The draw", puts `OFFER_COUNT` (`3`)
// offers on an overlay drawn from a pool that holds at least that many, so
// index `0` moves to index `1`.
//
// THE DRIVE. An isolated `playing` run holding nothing, whose pool is every
// base weapon and every passive, with every driver switch off; one level-up
// posed pending and the one `playing` tick that opens the overlay; then one
// real `ArrowDown`. The offer count is read back first, so a build that
// offered fewer fails on that rather than on the index.
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

it("reads menuIndex 1 after one ArrowDown on the overlay", async () => {
  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the press is made on");
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers on the overlay");
  assertEqual(overlay.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "levelup", "the screen after ArrowDown");
  assertEqual(after.menuIndex, 1, "menuIndex after one ArrowDown");
});
