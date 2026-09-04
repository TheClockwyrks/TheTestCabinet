// screens/levelup-back-inert — back does nothing on the level-up overlay.
//
// WHAT THIS DECIDES. One thing: a `back` press on `levelup` leaves the screen,
// its offers, and its highlight exactly as they were, so a choice cannot be
// escaped without being made.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "`back` and `pause` do nothing here."
//   specs/controls.md ("What each screen reads"): the `levelup` row lists `up`,
//   `down`, `confirm`, and `mute` and omits `back`, and "An action a row omits
//   does nothing on that screen."
//   specs/controls.md ("Actions and bindings"): `back` is `Escape`.
//
// THE DRIVE. An isolated `playing` run holding nothing, three ids posed, the
// overlay opened by the tick a queued level-up opens it, then one real `Escape`
// press over one frame. The reading is taken at `menuIndex` 0, where a build
// that moved the highlight on `back` shows a different index and one that left
// the overlay shows a different screen, so both ways of doing something are
// caught; the offers are read back whole, which catches a build that redrew
// them.
//
// THE TOLERANCE. None: a screen name, a menu index, and the offers are exact.

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

it("leaves the overlay, its offers, and its highlight untouched by Escape", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen Escape is pressed on");
  assertDeepEqual(opened.run.offers, [...OFFERS], "the offers before Escape");
  assertEqual(opened.menuIndex, 0, "the highlight before Escape");

  const after = await tap(h, "Escape");
  captureStill(h, "inert");

  assertEqual(after.screen, "levelup", "the screen Escape left the game on");
  assertDeepEqual(after.run.offers, [...OFFERS], "the offers after Escape");
  assertEqual(after.menuIndex, 0, "the highlight after Escape");
});
