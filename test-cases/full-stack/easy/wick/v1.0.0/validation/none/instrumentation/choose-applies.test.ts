// Wick — instrumentation/choose-applies: on `levelup`, `choose(1)` applies the
// second offer: the item is held, `pendingLevelUps` falls by one, and `screen`
// returns to `playing` when nothing else is queued.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `choose(index)`):
// "On `levelup`, accepts the offer at `index`, counted from `0` down the list,
// exactly as moving the highlight there and pressing `confirm` would: the item
// is applied, `pendingLevelUps` falls by one, and either the next queued
// overlay opens with a fresh pool or `screen` returns to `playing`."
// specs/progression.md — "Choosing": "A weapon or passive not held | It enters
// the first free slot of its kind at level `1`."
//
// WHY THE WORLD IS POSED AS IT IS. The loadout is empty, so every offer is a
// new item and "the item is held" reads as that id in the first slot of its
// kind at level `1`, whichever id the draw produced; the second offer is
// chosen rather than the first so an `index` that is ignored fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { isPassiveId, OFFER_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const CHOSEN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("applies the offer at the index and returns to playing", async () => {
  await isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the call is made on");
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers on the overlay");
  const offer = overlay.run.offers[CHOSEN]!;

  await h.debug.choose(CHOSEN);
  const chosen = await h.snapshot();
  await captureStill(h, "chosen");

  assertEqual(chosen.screen, "playing", "the screen after the last queued level-up");
  assertEqual(chosen.run.pendingLevelUps, 0, "pendingLevelUps after choose");
  if (isPassiveId(offer)) {
    assertDeepEqual(chosen.run.passives, [{ id: offer, level: 1 }], "the passive held");
    assertLength(chosen.run.weapons, 0, "the weapons held");
  } else {
    assertLength(chosen.run.weapons, 1, "the weapons held");
    assertEqual(chosen.run.weapons[0]?.id, offer, "the weapon held");
    assertEqual(chosen.run.weapons[0]?.level, 1, "the held weapon's level");
    assertLength(chosen.run.passives, 0, "the passives held");
  }
});
