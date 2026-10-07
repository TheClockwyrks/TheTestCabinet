// progression/accept-level-applies-next-tick — the row a leveled weapon reads
// is the new one from the next tick.
//
// THE FIGURE, FROM THE SPEC. specs/progression.md, Choosing: "A held weapon or
// passive | Its level rises by 1. Its table row and its derived-stat terms read
// the new level from the next tick". Taper's table in specs/weapons.md gives
// damage 10 at level 1 and 15 at level 2, and Hits and death fixes what a slash
// carries: "Damage per hit is the table damage times damageMul", which is 1
// with no Wick held, "fixed when the shape is created".
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, Taper alone held at level 1 and no passive held, so damageMul is 1 and
// the reading is the table row itself. Taper is put in front of the overlay
// through setNextOffers, the overlay is opened the real way, and choose(0)
// raises it to level 2. The slot's timer is then posed to 0 and weaponFire
// turned on, which "makes that the next tick" the weapon fires on
// (specs/instrumentation.md), and one playing tick is run: the slash it creates
// is the next slash after the level.
//
// THE TOLERANCE. FIGURE_TOLERANCE on the damage, a product of two figures the
// spec states exactly (15 × 1). A build still reading level 1 carries 10, five
// whole units away.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertWithin,
} from "../assert";
import { FIGURE_TOLERANCE, TAPER_LEVELS } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  present,
  zonesOf,
  type Harness,
} from "../harness";

/** Taper's row at level 2: damage 15, amount 1. */
const LEVEL_2 = TAPER_LEVELS[1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads damage 15 on the next slash after Taper rises from 1 to 2", async () => {
  isolate(h);
  const slot = holdWeapon(h, "taper", 1);
  h.debug.setNextOffers(["taper"]);

  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offer is accepted on",
  );
  assertDeepEqual(
    overlay.run.offers,
    ["taper"],
    "the offer put in front of it",
  );
  h.debug.choose(0);
  const accepted = h.snapshot();
  assertEqual(accepted.run.weapons[slot]?.level, 2, "the level accepted");

  armWeapon(h, slot);
  const after = await h.tick(1);
  captureStill(h, "row");

  const row = present(LEVEL_2, "Taper's level-2 row");
  const slashes = zonesOf(after, "taper");
  assertLength(slashes, row.amount, "the slashes level 2 fires");
  const slash = present(slashes[0], "the next slash after the level");
  assertWithin(
    slash.damage,
    row.damage,
    FIGURE_TOLERANCE,
    "the damage the new row gives it",
  );
});
