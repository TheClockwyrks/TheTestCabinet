// Wick — instrumentation/snapshot-pool-on-levelup: on `levelup`, `pool` lists
// the candidate pool computed from the slots as they stand, each id once, in
// `BASE_WEAPON_IDS` order then `PASSIVE_IDS` order, and `offers` is a subset
// of it.
//
// WHERE THE THRESHOLD COMES FROM. specs/instrumentation.md, the derived-fields
// table: "`pool` | on `levelup`, the candidate pool of `specs/progression.md`
// computed from the slots as they stand, each id once, in `BASE_WEAPON_IDS`
// order then `PASSIVE_IDS` order, so `offers` is a subset of it except for the
// lamp-oil offer over an empty pool". specs/progression.md — "The candidate
// pool": "every held base weapon below `MAX_WEAPON_LEVEL`, and every held
// passive below its max level"; "when a weapon slot is free, every base weapon
// not held whose evolution is not held"; "when a passive slot is free, every
// passive not held"; "An evolved weapon is never a candidate, and neither is
// the base weapon it came from". `candidatePool` in the harness is that rule
// restated, and the expected list is spelled out below as well so the two agree.
// "The overlay offers `OFFER_COUNT` distinct candidates drawn ... from the
// pool" fixes the subset and the count.
//
// WHY THE WORLD IS POSED AS IT IS. A loadout that exercises every clause at
// once: an evolved weapon (Pyre, which bars Taper), a base weapon below max
// (Ember 3, a `+1` candidate), a base weapon at max (Spark 8, excluded), a
// passive at max (Bellows 5, excluded), and a passive below max (Brass 1, a
// `+1` candidate), with slots free on both sides. The overlay is opened by the
// real path, a queued level-up and the tick that opens it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEachIn, assertEqual, assertLength } from "../assert";
import { OFFER_COUNT, type OfferId } from "../constants";
import {
  candidatePool,
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The pool the posed loadout yields, by the rule, in the documented order. */
const EXPECTED_POOL: OfferId[] = [
  "ember",
  "pin",
  "lantern",
  "halo",
  "oil-splash",
  "shard",
  "sconce",
  "flare",
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "tallow",
  "tinder",
  "soot",
  "lure",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the candidate pool on levelup, in order, with offers drawn from it", async () => {
  await isolate(h);
  await holdWeapon(h, "pyre", 1);
  await holdWeapon(h, "ember", 3);
  await holdWeapon(h, "spark", 8);
  await holdPassive(h, "bellows", 5);
  await holdPassive(h, "brass", 1);
  const posed = await h.snapshot();
  assertDeepEqual(
    candidatePool(posed),
    EXPECTED_POOL,
    "the harness's pool over the posed loadout",
  );

  const overlay = await openLevelUp(h);
  await captureStill(h, "pool");
  assertEqual(overlay.screen, "levelup", "the screen the queued level-up opened");
  assertDeepEqual(overlay.run.pool, EXPECTED_POOL, "the pool on levelup");
  assertLength(overlay.run.offers, OFFER_COUNT, "the offers drawn");
  assertEachIn(overlay.run.offers, overlay.run.pool, "each offer in the pool");
  assertEqual(
    new Set(overlay.run.offers).size,
    overlay.run.offers.length,
    "distinct offers",
  );
});
