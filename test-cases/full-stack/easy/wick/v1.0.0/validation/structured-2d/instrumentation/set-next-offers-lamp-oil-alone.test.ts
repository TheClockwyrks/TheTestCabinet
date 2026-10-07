// Wick — instrumentation/set-next-offers-lamp-oil-alone: with every slot
// filled and every held item at its max, `setNextOffers(['lamp-oil'])` is
// accepted and the next overlay presents lamp-oil alone.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setNextOffers(ids)`: "it is accepted ... when it holds `LAMP_OIL_ID` alone
// while the pool is empty". `specs/progression.md`, "The candidate pool": a
// held base weapon at `MAX_WEAPON_LEVEL` and a held passive at its max are
// not candidates, and with no slot free nothing new is; "When the pool is
// empty the overlay offers exactly one item, `LAMP_OIL_ID`".
//
// THE LOADOUT. Six base weapons at level 8 (`WEAPON_SLOTS` full) and six
// passives at their `PASSIVES` max levels (`PASSIVE_SLOTS` full), so the pool
// is empty; the list posed and the overlay opened by the real tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  LAMP_OIL_ID,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  PASSIVE_SLOTS,
  WEAPON_SLOTS,
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
  "spark",
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

afterEach(() => {
  h.dispose();
});

it("accepts lamp-oil alone over an empty pool and presents it", async () => {
  isolate(h);
  for (const id of WEAPONS) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of PASSIVE_IDS_HELD) holdPassive(h, id, PASSIVES[id].maxLevel);
  const loaded = h.snapshot();
  assertEqual(loaded.run.weapons.length, WEAPON_SLOTS, "weapon slots filled");
  assertEqual(
    loaded.run.passives.length,
    PASSIVE_SLOTS,
    "passive slots filled",
  );

  h.debug.setNextOffers([LAMP_OIL_ID]);
  assertDeepEqual(
    h.snapshot().run.nextOffers,
    [LAMP_OIL_ID],
    "run.nextOffers after the pose",
  );
  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "oil");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertDeepEqual(
    overlay.run.pool,
    [],
    "the pool with every slot full and maxed",
  );
  assertDeepEqual(overlay.run.offers, [LAMP_OIL_ID], "the offers presented");
});
