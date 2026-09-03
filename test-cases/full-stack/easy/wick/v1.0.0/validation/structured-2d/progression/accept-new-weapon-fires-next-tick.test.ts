// Wick — progression/accept-new-weapon-fires-next-tick: a weapon just accepted
// fires on the first `playing` tick it is held.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing", the offer table: "A weapon's cooldown timer starts at `0`, so it
// fires on the first `playing` tick it is held", and "otherwise `screen`
// returns to `playing` and the simulation resumes on the next tick".
// `specs/weapons.md`, Pin: "A dart is a circle of `radius`, fired horizontally
// in the facing direction ... Pin fires whether or not any enemy exists", and
// "Amount `n` darts fire on the same tick"; `PIN_LEVELS` gives level `1` an
// amount of `1`, and `specs/passives.md` makes `amountBonus` `0` with no
// Mirror held.
//
// THE POSE. An isolated `playing` run holding nothing, with
// `setNextOffers(["pin"])` fixing the single offer, so the acceptance is Pin
// and the run holds one weapon and no passive. One level-up is queued, so the
// acceptance closes the overlay to `playing`. `weaponFire` alone is then turned
// on, since it is the switch that lets "due weapons fire"
// (`specs/instrumentation.md`), and exactly one tick is run. Pin needs no
// target, so the empty world is enough; nothing else can create a projectile,
// because no other weapon is held and no enemy exists.
//
// THE TOLERANCE. Exact: the count of darts the tick created.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { PIN_LEVELS, type OfferId } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  projectilesOf,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["pin"];
/** Pin's level-1 amount, with no Mirror held to add to it. */
const DARTS = PIN_LEVELS[0].amount;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates Pin's darts on the first playing tick after the acceptance", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);

  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(overlay.run.offers, OFFERS, "the overlay's offers");

  h.debug.choose(0);
  const accepted = h.snapshot();
  assertEqual(accepted.screen, "playing", "screen after the last acceptance");
  assertLength(accepted.run.projectiles, 0, "projectiles before the tick");

  h.debug.setWeaponFire(true);
  const fired = await advanceTicks(h, 1);
  captureStill(h, "fired");

  assertLength(
    projectilesOf(fired, "pin"),
    DARTS,
    "Pin darts the first playing tick created (specs/progression.md, Choosing)",
  );
});
