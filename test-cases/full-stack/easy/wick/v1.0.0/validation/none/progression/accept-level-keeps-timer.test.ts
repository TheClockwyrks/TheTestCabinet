// progression/accept-level-keeps-timer — a leveled weapon's running timer keeps
// counting.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"), the offer
// table: "A held weapon or passive | Its level rises by `1`. Its table row and
// its derived-stat terms read the new level from the next tick; A WEAPON'S
// RUNNING COOLDOWN TIMER KEEPS COUNTING." specs/weapons.md's cooldown timers
// count down by `TICK_DT` on each `playing` tick `weaponFire` is on, and
// specs/overview.md fixes `TICK_DT` as `1 / TICK_HZ` with `TICK_HZ` `60`. So a
// timer standing at `1.0` when the level is accepted still reads `1.0` on the
// overlay and reads `1.0 − TICK_DT` after the next playing tick, rather than
// being restarted at the new row's cooldown.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with nothing alive and
// Taper alone held at `3`, with `weaponFire` held off while the overlay is
// reached so the posed timer is exactly what the acceptance finds, and turned on
// for the one tick afterwards so the counting this point is about is the only
// counting that happens. The timer is posed at `1.0`, well under Taper's row
// cooldown of `1.35` at either level, so a build that restarted the timer reads
// a larger figure and a build that dropped it reads `0`; and `1.0` is far enough
// above zero that the weapon fires on no tick this check runs, so nothing is
// created to confuse the reading.
//
// THE TOLERANCE. The timer is a real number of seconds, read within `TIMER_TOL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { TICK_DT, TIMER_TOL, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The level the held weapon stands at before the acceptance. */
const HELD_LEVEL = 3;

/** The timer posed: mid-count, under either row's cooldown, so it fires on no tick here. */
const POSED_TIMER = 1.0;

/** The offer the overlay is made to present: the held weapon's own `+1`. */
const OFFERED: OfferId[] = ["taper"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the running timer across the level and counts on from it", async () => {
  await isolate(h);
  const slot = await holdWeapon(h, "taper", HELD_LEVEL);
  await h.debug.setWeaponCooldown(slot, POSED_TIMER);
  await h.debug.setNextOffers(OFFERED);

  const overlay = await openLevelUp(h);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertDeepEqual(
    overlay.run.offers,
    OFFERED,
    "the offers the overlay presents",
  );
  assertNear(
    overlay.run.weapons[slot]?.cooldown ?? Number.NaN,
    POSED_TIMER,
    TIMER_TOL,
    "the running timer on the overlay",
  );

  await h.debug.choose(0);
  const accepted = await h.snapshot();
  assertEqual(
    accepted.run.weapons[slot]?.level,
    HELD_LEVEL + 1,
    "the level the acceptance left",
  );
  assertNear(
    accepted.run.weapons[slot]?.cooldown ?? Number.NaN,
    POSED_TIMER,
    TIMER_TOL,
    "the running timer the acceptance left",
  );

  await enable(h, "weaponFire");
  const ticked = await h.step(1);
  await captureStill(h, "timer");

  assertNear(
    ticked.run.weapons[slot]?.cooldown ?? Number.NaN,
    POSED_TIMER - TICK_DT,
    TIMER_TOL,
    "the running timer after the next playing tick",
  );
});
