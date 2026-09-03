// instrumentation/set-screen-levelup — on playing with pendingLevelUps posed
// to 1, `setScreen('levelup')` opens the overlay exactly as the end of a
// playing tick does: screen levelup with menuIndex 0, the pool computed from
// the slots, and the offers filled from a posed nextOffers.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `levelup`: from "`playing`, with `pendingLevelUps` at least `1`", "Opens
// the overlay exactly as the end of a `playing` tick opens it: the pool is
// computed, `nextOffers` is consumed or the draw is made, and `offers` is
// filled". specs/progression.md gives the pool; `snapshot-pool-on-levelup`
// owns its order, so here it is read as non-empty and holding every offer.
//
// THE POSE. An isolated run holding Taper, a queued level-up, and a posed
// `nextOffers` of three candidates, so the offers the row fills are known
// exactly and `nextOffers` reads null once consumed. No tick runs: the pose
// is the route.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNull,
  assertTrue,
} from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import type { OfferId } from "../surface";

const QUEUED: OfferId[] = ["ember", "wick", "taper"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the overlay with the pool and the queued offers", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setPendingLevelUps(1);
  h.debug.setNextOffers(QUEUED);

  h.debug.setScreen("levelup");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "overlay");

  assertEqual(s.screen, "levelup", "the screen after the pose");
  assertEqual(s.menuIndex, 0, "menuIndex on opening");
  assertEqual(s.run.pendingLevelUps, 1, "pendingLevelUps, the one presented");
  assertGreaterThan(s.run.pool.length, 0, "the pool computed from the slots");
  assertDeepEqual(s.run.offers, QUEUED, "the offers filled from nextOffers");
  for (const offer of s.run.offers) {
    assertTrue(s.run.pool.includes(offer), `offer ${offer} in the pool`);
  }
  assertNull(s.run.nextOffers, "nextOffers, consumed by the overlay");
});
