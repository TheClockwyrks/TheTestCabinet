// instrumentation/snapshot-pool-on-levelup — on levelup, `pool` lists the
// candidate pool computed from the slots as they stand, each id once, in
// BASE_WEAPON_IDS order then PASSIVE_IDS order, and `offers` is a subset of it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, the "Derived from"
// table: `pool` is "on `levelup`, the candidate pool of `specs/progression.md`
// computed from the slots as they stand, each id once, in `BASE_WEAPON_IDS`
// order then `PASSIVE_IDS` order, so `offers` is a subset of it except for the
// lamp-oil offer over an empty pool; on every other screen an empty list".
// specs/progression.md, "The candidate pool": "every held base weapon below
// MAX_WEAPON_LEVEL, and every held passive below its max level, each as a +1
// level offer; when a weapon slot is free, every base weapon not held whose
// evolution is not held; when a passive slot is free, every passive not held",
// and "An evolved weapon is never a candidate, and neither is the base weapon
// it came from".
//
// THE POSE, chosen so every clause of the rule decides an id: Pyre held (so
// neither `pyre` nor `taper` is a candidate), Ember at MAX_WEAPON_LEVEL (held
// but not below the max, so out), Halo at 3 (held and below, so in as +1),
// Brass at its max 3 (out), Bellows at 2 (in), free slots of both kinds (so
// every unheld base weapon and passive is in). The overlay is opened by the
// real path, a queued level-up and one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { MAX_WEAPON_LEVEL, OFFER_COUNT, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The pool the rule gives the posed slots, in the fixed order. */
const EXPECTED_POOL = [
  "pin",
  "lantern",
  "halo",
  "oil-splash",
  "spark",
  "shard",
  "sconce",
  "flare",
  "wick",
  "oil",
  "glass",
  "mirror",
  "bellows",
  "tallow",
  "tinder",
  "soot",
  "lure",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lists the candidate pool in order, with the offers drawn from it", async () => {
  isolate(h);
  holdWeapon(h, "pyre", 1);
  holdWeapon(h, "ember", MAX_WEAPON_LEVEL);
  holdWeapon(h, "halo", 3);
  holdPassive(h, "brass", PASSIVES.brass.maxLevel);
  holdPassive(h, "bellows", 2);

  const s = await openLevelUp(h, 1);
  captureStill(h, "pool");

  assertEqual(s.screen, "levelup", "the overlay opened by the tick");
  assertDeepEqual(s.run.pool, EXPECTED_POOL, "pool on levelup");
  assertEqual(s.run.offers.length, OFFER_COUNT, "the offers drawn");
  assertEqual(
    new Set(s.run.offers).size,
    s.run.offers.length,
    "the offers, distinct",
  );
  for (const offer of s.run.offers) {
    assertTrue(
      s.run.pool.includes(offer),
      `offer ${offer} drawn from the pool`,
    );
  }
});
