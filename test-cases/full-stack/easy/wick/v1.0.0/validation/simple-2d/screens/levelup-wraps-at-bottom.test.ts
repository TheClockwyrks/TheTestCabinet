// screens/levelup-wraps-at-bottom — the overlay's highlight wraps past the bottom.
//
// WHAT THIS DECIDES. One edge case, in one direction: on `levelup` holding
// three offers with the LAST highlighted, one `down` press leaves the highlight
// on the first rather than off the end of the list or stuck where it was.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "`up` and `down` move the highlight and wrap at
//   both ends".
//   specs/progression.md ("Choosing"): "`up` and `down` move the highlight by
//   one and wrap at both ends".
//   specs/instrumentation.md (`setNextOffers`): "the overlay then presents
//   exactly that list in that order", so the last offer's index is
//   `offers.length − 1`.
//
// THE DRIVE. An isolated `playing` run holding nothing, three ids posed, the
// overlay opened by the tick a queued level-up opens it, then `ArrowDown`
// pressed to the last offer, asserted, then the press this point is about.
//
// THE TOLERANCE. None: a menu index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

/** Three candidates of an empty loadout's pool. */
const OFFERS = ["ember", "shard", "glass"] as const;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("wraps the overlay's highlight from the last offer to the first", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  let staged = await openLevelUp(h, 1);
  assertDeepEqual(
    staged.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );

  const last = staged.run.offers.length - 1;
  for (let press = 0; press < last; press += 1) {
    staged = await tap(h, "ArrowDown");
  }
  assertEqual(staged.screen, "levelup", "the screen ArrowDown is pressed on");
  assertEqual(staged.menuIndex, last, "the highlight on the last offer");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "levelup", "the screen ArrowDown left the game on");
  assertEqual(
    after.menuIndex,
    0,
    "the highlight after ArrowDown on the last offer",
  );
});
