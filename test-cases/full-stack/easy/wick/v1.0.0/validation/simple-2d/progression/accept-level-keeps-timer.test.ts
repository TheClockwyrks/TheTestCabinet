// progression/accept-level-keeps-timer — a leveled weapon's running cooldown
// timer is not reset by the acceptance and counts on from where it stood.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Choosing: "A held weapon or
// passive | Its level rises by 1. Its table row and its derived-stat terms read
// the new level from the next tick; a weapon's running cooldown timer keeps
// counting." specs/world.md, Timers: "On every tick a timer counts down by
// TICK_DT and is held at 0", and a timer "held by one of the driver switches
// ... a weapon's cooldown timer while weaponFire is off ... neither counts down
// nor is due until the switch is on again". From 1.0 the first counting tick
// therefore leaves 1 − TICK_DT.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off, Taper alone held. Its timer is posed to 1.0 through setWeaponCooldown,
// and weaponFire stays off through the tick that opens the overlay, so the
// timer stands at exactly 1.0 when the offer is accepted and the reading is
// about the acceptance alone. Taper is put in front of the overlay through
// setNextOffers, choose(0) accepts it, and weaponFire is then turned on for
// exactly one playing tick, which is the first tick the timer counts on.
//
// THE TOLERANCE. MOTION_TOLERANCE on the timer, which a build counts down tick
// by tick. A build that reset the timer on the level reads 1.35 × cooldownMul,
// Taper's whole cooldown, or 0, each a third of a second or more away.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  openLevelUp,
  present,
  type Harness,
} from "../harness";

/** The timer posed: mid-count, far from both 0 and Taper's whole cooldown. */
const POSED_TIMER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the timer at 1.0 on the overlay and one tick lower after the next tick", async () => {
  isolate(h);
  const slot = holdWeapon(h, "taper", 1);
  h.debug.setWeaponCooldown(slot, POSED_TIMER);
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

  enable(h, "weaponFire");
  const after = await h.tick(1);
  captureStill(h, "timer");

  const onOverlay = present(accepted.run.weapons[slot], "the leveled Taper");
  assertEqual(onOverlay.level, 2, "the level the acceptance raised it to");
  assertWithin(
    onOverlay.cooldown,
    POSED_TIMER,
    MOTION_TOLERANCE,
    "the timer the acceptance left standing",
  );
  const counting = present(after.run.weapons[slot], "Taper on the next tick");
  assertWithin(
    counting.cooldown,
    POSED_TIMER - TICK_DT,
    MOTION_TOLERANCE,
    "the timer counting on from where it stood",
  );
});
