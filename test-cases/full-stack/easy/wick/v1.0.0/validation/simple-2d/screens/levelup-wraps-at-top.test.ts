// screens/levelup-wraps-at-top — the overlay's highlight wraps past the top.
//
// WHAT THIS DECIDES. One edge case, in one direction: on `levelup` holding
// three offers with the first highlighted, one `up` press leaves the highlight
// on the LAST offer rather than off the top of the list or stuck where it was.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "`menuIndex` is `0` on opening. `up` and `down`
//   move the highlight and wrap at both ends".
//   specs/instrumentation.md (`setNextOffers`): "the overlay then presents
//   exactly that list in that order", so the last offer's index is
//   `offers.length − 1`.
//
// THE DRIVE. An isolated `playing` run holding nothing, three ids posed, the
// overlay opened by the tick a queued level-up opens it, which leaves the
// highlight on the first offer with no key pressed, then the one `ArrowUp` this
// point is about.
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

it("wraps the overlay's highlight from the first offer to the last", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );
  assertEqual(opened.screen, "levelup", "the screen ArrowUp is pressed on");
  assertEqual(opened.menuIndex, 0, "the highlight before ArrowUp");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "levelup", "the screen ArrowUp left the game on");
  assertEqual(
    after.menuIndex,
    opened.run.offers.length - 1,
    "the highlight after ArrowUp on the first offer",
  );
});
