// instrumentation/set-next-offers-lamp-oil-alone — with every slot filled and
// every held item at its max, `setNextOffers(['lamp-oil'])` is accepted and
// the next overlay presents lamp-oil alone.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setNextOffers`:
// the list "is accepted ... when it holds `LAMP_OIL_ID` alone while the pool
// is empty". specs/progression.md, "The candidate pool": held items at their
// max are not candidates and a filled slot kind adds no new items, so six base
// weapons at MAX_WEAPON_LEVEL and six passives at their max leave the pool
// empty; "When the pool is empty the overlay offers exactly one item,
// `LAMP_OIL_ID`".
//
// THE POSE. Six weapons that need no target and no placement (so nothing
// fires or is placed with the switches off), each at level 8, and six passives
// at their max; the list; the overlay by the real path.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { LAMP_OIL_ID, MAX_WEAPON_LEVEL, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const WEAPONS = ["taper", "ember", "pin", "spark", "shard", "sconce"] as const;
const PASSIVE_SET = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts lamp oil alone over an empty pool", async () => {
  isolate(h);
  for (const id of WEAPONS) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of PASSIVE_SET) holdPassive(h, id, PASSIVES[id].maxLevel);
  h.debug.setNextOffers([LAMP_OIL_ID]);

  const s = await openLevelUp(h, 1);
  captureStill(h, "oil");

  assertEqual(s.screen, "levelup", "the overlay opened");
  assertLength(s.run.pool, 0, "the pool with every slot filled at its max");
  assertDeepEqual(s.run.offers, [LAMP_OIL_ID], "the offers: lamp oil alone");
});
