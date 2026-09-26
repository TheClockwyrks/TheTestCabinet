// progression/accept-new-weapon-fires-next-tick — a newly accepted weapon fires
// on the first playing tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/progression.md ("Choosing"), the offer
// table: "A weapon's cooldown timer starts at `0`, so it fires on the first
// `playing` tick it is held." Its closing paragraph gives the tick that is:
// "otherwise `screen` returns to `playing` and the simulation resumes on the
// next tick." specs/weapons.md gives Pin's first row `amount` `1`, and
// specs/passives.md leaves `amountBonus` at `0` with no Mirror held, so the
// firing tick creates exactly one Pin dart. Pin is not a weapon that "needs a
// target", so it fires over an empty night.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with nothing alive and no
// weapon held, so nothing but the accepted weapon can create a projectile, and
// `weaponFire` alone turned back on, because that is the faculty this point
// exercises. The overlay is opened from a queued level-up with the offer fixed
// by `setNextOffers`, so the acceptance is of Pin rather than of a draw, and the
// acceptance takes the queue to `0` so the overlay closes to `playing`. One tick
// is then run: a build that starts an acquired weapon's timer at its cooldown
// rather than at `0` creates nothing on it.
//
// THE TOLERANCE. None: a projectile of the weapon exists on that tick or it
// does not, and its count is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { weaponRow, type OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  newProjectiles,
  openLevelUp,
  type Harness,
} from "../harness";

/** The offer the overlay is made to present: a projectile weapon needing no target. */
const OFFERED: OfferId[] = ["pin"];

/** The darts one firing makes at level 1, with no Mirror held. */
const DARTS = weaponRow("pin", 1).amount ?? 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates the accepted weapon's darts on the tick after the overlay closes", async () => {
  await isolate(h, { on: ["weaponFire"] });
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

  await h.debug.choose(0);
  const accepted = await h.snapshot();
  assertEqual(
    accepted.screen,
    "playing",
    "the screen the last acceptance returned to",
  );

  const fired = await h.step(1);
  await captureStill(h, "fired");

  const made = newProjectiles(accepted, fired);
  assertLength(made, DARTS, "the projectiles the first playing tick created");
  assertDeepEqual(
    made.map((shape) => shape.weapon),
    Array.from({ length: DARTS }, () => "pin"),
    "the weapon each new projectile belongs to",
  );
});
