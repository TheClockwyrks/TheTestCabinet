// Wick — instrumentation/set-next-offers-lamp-oil-alone: with every slot filled
// and every held item at its max, `setNextOffers(["lamp-oil"])` is accepted and
// the next overlay presents lamp-oil alone.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setNextOffers(ids)`): the list "is accepted when every id is a candidate of
// the pool at that moment, or when it holds `LAMP_OIL_ID` alone while the pool
// is empty, and the overlay then presents exactly that list in that order".
// specs/progression.md: the pool holds held items below their max and, only
// "when a weapon slot is free" or "when a passive slot is free", new items;
// "When the pool is empty the overlay offers exactly one item, `LAMP_OIL_ID`".
//
// WHY THE WORLD IS POSED AS IT IS. Six base weapons at `MAX_WEAPON_LEVEL` and
// six passives at their own max fill every slot with nothing left to level, so
// the pool is empty by every clause; the list is then the one the sentence
// accepts over an empty pool.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  LAMP_OIL_ID,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const WEAPONS: BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "lantern",
  "halo",
  "oil-splash",
];
const PASSIVE_IDS_HELD: PassiveId[] = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts lamp-oil alone over an empty pool and presents it", async () => {
  await isolate(h);
  for (const id of WEAPONS) await holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of PASSIVE_IDS_HELD)
    await holdPassive(h, id, PASSIVES[id].maxLevel);
  await h.debug.setNextOffers([LAMP_OIL_ID]);
  const posed = await h.snapshot();
  assertDeepEqual(
    posed.run.nextOffers,
    [LAMP_OIL_ID],
    "nextOffers after the pose",
  );

  const overlay = await openLevelUp(h);
  await captureStill(h, "oil");
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertLength(overlay.run.pool, 0, "the pool over a full, maxed loadout");
  assertDeepEqual(
    overlay.run.offers,
    [LAMP_OIL_ID],
    "the offers the overlay presents",
  );
});
