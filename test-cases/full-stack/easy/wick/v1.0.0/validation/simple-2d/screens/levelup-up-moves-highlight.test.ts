// screens/levelup-up-moves-highlight — up moves the overlay's highlight up.
//
// WHAT THIS DECIDES. One thing, in one direction: on `levelup` holding three
// offers with the second highlighted, one `up` press leaves the highlight on
// the first.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "`up` and `down` move the highlight and wrap at
//   both ends".
//   specs/controls.md ("What each screen reads"): the `levelup` row, and `up`
//   is `ArrowUp`, `KeyW`.
//
// THE DRIVE, AND WHY IT PRESSES TWICE. Nothing poses `menuIndex`: it "is `0` on
// entering every screen" (specs/state.md) and a key is the only thing that
// moves it, so the second offer is reached with one `ArrowDown` and asserted
// before the press this point is about. A build whose `down` is broken fails
// this point too, which is the honest cost of a state the surface does not pose.
//
// THE TOLERANCE. None: a menu index and a screen name are exact.

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

it("moves the overlay's highlight from the second offer to the first", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );

  const staged = await tap(h, "ArrowDown");
  assertEqual(staged.screen, "levelup", "the screen ArrowUp is pressed on");
  assertEqual(staged.menuIndex, 1, "the highlight before ArrowUp");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "levelup", "the screen ArrowUp left the game on");
  assertEqual(after.menuIndex, 0, "the highlight after one ArrowUp");
});
