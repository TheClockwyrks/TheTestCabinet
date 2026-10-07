// screens/levelup-down-moves-highlight — down moves the overlay's highlight down.
//
// WHAT THIS DECIDES. One thing, in one direction: on `levelup` holding three
// offers with the first highlighted, one `down` press leaves the highlight on
// the second.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "`menuIndex` is `0` on opening. `up` and `down`
//   move the highlight and wrap at both ends".
//   specs/controls.md ("What each screen reads"): "`levelup` | none | `up`,
//   `down` move the highlight, wrapping; `confirm` accepts the highlighted
//   offer; `mute`", and `down` is `ArrowDown`, `KeyS`.
//   specs/instrumentation.md (`setNextOffers`): "the overlay then presents
//   exactly that list in that order."
//
// THE DRIVE. An isolated `playing` run holding nothing, so all three posed ids
// are candidates of the pool (specs/progression.md); the overlay is opened by
// the tick a queued level-up opens it, which leaves the highlight on the first
// offer with no key pressed; then one real `ArrowDown` over one frame, which
// ticks nothing, since `levelup` advances nothing (specs/ui.md).
//
// THE TOLERANCE. None: a menu index, a screen name, and the offers are exact.

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

it("moves the overlay's highlight from the first offer to the second", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen ArrowDown is pressed on");
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );
  assertEqual(opened.menuIndex, 0, "the highlight before ArrowDown");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "levelup", "the screen ArrowDown left the game on");
  assertEqual(after.menuIndex, 1, "the highlight after one ArrowDown");
});
