// Wick — progression/accept-level-applies-next-tick: a leveled item's new table
// row is in force from the next tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing", the offer table: "A held weapon or passive ... Its table row and
// its derived-stat terms read the new level from the next tick."
// `specs/weapons.md`, Taper's table: level `1` deals `10` damage and level `2`
// deals `15`, and `specs/passives.md` makes `damageMul` `1` with no Wick held,
// so the slash a tick creates carries damage `15` exactly.
// `specs/instrumentation.md`, `setWeaponCooldown`: `0` makes the weapon due on
// the next tick.
//
// THE POSE. An isolated `playing` run holding Taper alone at level `1`, with
// `setNextOffers(["taper"])` fixing the single offer to the held weapon. After
// the acceptance the overlay closes to `playing`; the timer is posed to `0` and
// `weaponFire` turned on, so exactly one tick fires exactly one slash. No enemy
// exists and Taper needs no target (`specs/weapons.md`, "Targeting summary"),
// so the slash is created regardless and its damage is read off the zone. A
// build that carries the old row into the next tick reads `10` here.
//
// THE TOLERANCE. `REAL_EPS` on the damage, a real number that is here a whole
// table figure times a multiplier of `1`; the nearest other row is `5` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNear } from "../assert";
import { REAL_EPS, TAPER_LEVELS, type OfferId } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  zonesOf,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["taper"];
const LEVEL_BEFORE = 1;
/** Taper's level-2 damage, with `damageMul` 1. */
const DAMAGE = TAPER_LEVELS[LEVEL_BEFORE].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("cuts for Taper's level-2 damage on the slash after the level is accepted", async () => {
  isolate(h);
  const slot = holdWeapon(h, "taper", LEVEL_BEFORE);
  h.debug.setNextOffers(OFFERS);

  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(overlay.run.offers, OFFERS, "the overlay's offers");

  h.debug.choose(0);
  armWeapon(h, slot);
  const fired = await advanceTicks(h, 1);
  captureStill(h, "row");

  const slashes = zonesOf(fired, "taper");
  assertLength(
    slashes,
    TAPER_LEVELS[LEVEL_BEFORE].amount,
    "Taper slashes the firing tick created at level 2",
  );
  assertNear(
    slashes[0].damage,
    DAMAGE,
    REAL_EPS,
    "the slash's damage after the level rose to 2 (specs/progression.md, Choosing)",
  );
});
