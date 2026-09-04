// Wick — progression/accept-level-keeps-timer: a leveled weapon's running
// cooldown timer is kept and keeps counting.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing", the offer table: "A held weapon or passive ... a weapon's running
// cooldown timer keeps counting." `specs/instrumentation.md`,
// `setWeapon(slot, id, level)`: "when only the level changes the timer keeps
// counting", and of `weaponFire`: while it is on "Cooldown timers count down",
// while it is off "Every cooldown timer holds where it stands".
//
// THE POSE. An isolated `playing` run holding Taper alone at level `3`, its
// timer posed to `1.0` seconds, with `setNextOffers(["taper"])` fixing the
// single offer to the held weapon. `weaponFire` is off while the overlay opens,
// so the timer stands at exactly `1.0` when the acceptance happens and the
// reading afterwards is the acceptance's doing alone. `weaponFire` is then
// turned on for one tick: `1.0` is below Taper's level-4 cooldown of `1.35`
// (`specs/weapons.md`), so the tick counts the timer down by `TICK_DT` rather
// than firing and re-arming it. A build that zeroes the timer on a level reads
// `0` at the first assertion; one that restarts it at the row's cooldown reads
// `1.35`.
//
// THE TOLERANCE. `REAL_EPS` on the timer, a real number that is here a posed
// value and a difference of two stated reals.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNear } from "../assert";
import { REAL_EPS, TAPER_LEVELS, TICK_DT, type OfferId } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["taper"];
const LEVEL_BEFORE = 3;
/** A timer short of the level-4 cooldown, so the next tick counts rather than fires. */
const TIMER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a Taper timer of 1.0 across the level and counts it down on the next tick", async () => {
  if (TIMER >= TAPER_LEVELS[LEVEL_BEFORE].cooldown) {
    throw new Error(
      "the posed timer must stand below the new level's cooldown",
    );
  }
  isolate(h);
  const slot = holdWeapon(h, "taper", LEVEL_BEFORE);
  h.debug.setWeaponCooldown(slot, TIMER);
  h.debug.setNextOffers(OFFERS);

  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(overlay.run.offers, OFFERS, "the overlay's offers");
  assertNear(
    overlay.run.weapons[slot].cooldown,
    TIMER,
    REAL_EPS,
    "the timer standing when the overlay opened",
  );

  h.debug.choose(0);
  const accepted = h.snapshot();
  h.debug.setWeaponFire(true);
  const ticked = await advanceTicks(h, 1);
  captureStill(h, "timer");

  assertNear(
    accepted.run.weapons[slot].cooldown,
    TIMER,
    REAL_EPS,
    "the timer after the level was accepted (specs/progression.md, Choosing)",
  );
  assertNear(
    ticked.run.weapons[slot].cooldown,
    TIMER - TICK_DT,
    REAL_EPS,
    "the timer after one tick with weaponFire on",
  );
});
