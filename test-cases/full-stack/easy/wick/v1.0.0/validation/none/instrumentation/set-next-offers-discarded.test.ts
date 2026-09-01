// Wick — instrumentation/set-next-offers-discarded: a list holding an id that
// is not a candidate of the pool when the overlay opens is discarded whole,
// `nextOffers` reads `null`, and the overlay draws at random.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): "Otherwise it is discarded whole and the overlay draws
// at random; an evolved weapon's id is never in a pool, so a list naming one is
// always discarded. One overlay consumes it". specs/progression.md: a held
// base weapon at `MAX_WEAPON_LEVEL` is not a candidate; the draw is
// "`OFFER_COUNT` distinct candidates drawn ... from the pool".
//
// WHY THE WORLD IS POSED AS IT IS. Spark is held at its max level, so its id
// is in the list but not in the pool while the other two ids are candidates; a
// build that keeps the candidates and drops the stray presents a two-item
// list, and one that presents the list whole shows Spark. Discarded whole, the
// overlay draws three from the pool, and Spark cannot be among them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEachIn, assertEqual, assertLength, assertNull } from "../assert";
import { MAX_WEAPON_LEVEL, OFFER_COUNT, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const QUEUED: OfferId[] = ["spark", "pin", "halo"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards a list naming a non-candidate, whole, and draws at random", async () => {
  await isolate(h);
  await holdWeapon(h, "spark", MAX_WEAPON_LEVEL);
  await h.debug.setNextOffers(QUEUED);

  const overlay = await openLevelUp(h);
  await captureStill(h, "discarded");
  assertEqual(overlay.screen, "levelup", "the screen the queued level-up opened");
  assertNull(overlay.run.nextOffers, "nextOffers once the overlay opened");
  assertEqual(overlay.run.pool.includes("spark"), false, "Spark at max in the pool");
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers drawn in place of the list");
  assertEachIn(overlay.run.offers, overlay.run.pool, "each drawn offer in the pool");
  assertEqual(overlay.run.offers.includes("spark"), false, "the stray id among the offers");
});
