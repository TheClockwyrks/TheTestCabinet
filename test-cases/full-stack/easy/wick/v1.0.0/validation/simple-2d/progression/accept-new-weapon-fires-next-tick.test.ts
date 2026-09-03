// progression/accept-new-weapon-fires-next-tick — a weapon accepted from the
// overlay fires on the first playing tick after it closes.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Choosing: "A weapon's cooldown
// timer starts at 0, so it fires on the first playing tick it is held", and
// "screen returns to playing and the simulation resumes on the next tick".
// specs/weapons.md, Cooldown timers: "On acquisition the timer is 0, so a
// weapon fires on the first playing tick it is held; Taper, Lantern, Halo, Oil
// Splash, Pin, Shard, and Flare need no target and fire the same way", and
// specs/world.md, Timers: "a timer at 0 stays due on every tick until it is set
// again". Pin at level 1 fires amount 1 dart by its table in specs/weapons.md.
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off, so no other weapon can put a projectile in the
// world. Pin is put in front of the overlay through setNextOffers, a candidate
// because every weapon slot is free, the overlay is opened the real way with
// one level-up queued, and choose(0) accepts it, which returns the screen to
// playing. weaponFire, the switch whose faculty is the firing itself, is then
// turned on and exactly one playing tick is run.
//
// THE TOLERANCE. None: the dart is in the world after that tick or it is not.
// Pin needs no target, so nothing about the empty field can excuse its absence.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PIN_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  openLevelUp,
  projectilesOf,
  type Harness,
} from "../harness";

/** Pin's amount at level 1, from its table: one dart a firing. */
const DARTS = PIN_LEVELS[0]?.amount ?? 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("creates Pin's dart on the first playing tick after the overlay closes", async () => {
  isolate(h);
  h.debug.setNextOffers(["pin"]);

  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offer is accepted on",
  );
  assertDeepEqual(overlay.run.offers, ["pin"], "the offer put in front of it");
  h.debug.choose(0);
  const closed = h.snapshot();
  assertEqual(
    closed.screen,
    "playing",
    "the screen the acceptance returned to",
  );
  assertEqual(closed.run.projectiles.length, 0, "an empty field to fire into");

  enable(h, "weaponFire");
  const after = await h.tick(1);
  captureStill(h, "fired");

  assertEqual(
    projectilesOf(after, "pin").length,
    DARTS,
    "Pin's darts on its first playing tick",
  );
});
