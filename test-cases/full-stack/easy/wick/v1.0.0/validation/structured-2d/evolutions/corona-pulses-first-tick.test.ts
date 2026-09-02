// evolutions/corona-pulses-first-tick — Corona pulses on the first playing
// tick it is held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Corona
// pulses on its first tick and on every tick its cooldown timer is due; each
// pulse deals `damage` to every enemy whose circle overlaps the aura", with
// `CORONA_STATS` giving damage 12 and radius 150. With no Wick held
// `damageMul` is 1 (`specs/passives.md`), so the pulse removes exactly 12
// (`specs/weapons.md`, Hits and death). The aura itself is created on that
// same tick, through the placement part of phase 5 (`specs/world.md`, One
// tick), so the first tick Corona is held both places the aura and pulses it.
//
// WHY THE ENEMY IS A HOUND. A moth's 5 `hp` (`specs/enemies.md`) cannot show a
// removal of 12; a hound's 120 reads it exactly, so a build that pulsed for
// the wrong figure, or twice, fails here as clearly as one that did not pulse
// at all. It stands `INSIDE` (120) units out, inside the 168 at which its
// circle and the aura's overlap (`specs/weapons.md`, Shapes and overlap).
//
// WHY NOTHING TOUCHES THE TIMER. Corona is held through `setWeapon` and
// `weaponFire` turned on, and nothing else: the requirement is that the FIRST
// tick pulses, so posing the timer would arrange the very thing under test.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Corona
// and that hound, `weaponFire` the one switch on, so no other weapon fires and
// neither enemy motion nor contact can move the reading.
//
// THE TOLERANCE. `REAL_EPS` on the `hp`: one subtraction of a row figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { CORONA_STATS, ENEMIES, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { INSIDE, holdCorona, hpOf } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes 12 from a hound inside the aura on the first playing tick Corona is held", async () => {
  if (!(INSIDE < CORONA_STATS.radius + ENEMIES.hound.radius)) {
    throw new Error("the hound must overlap the aura");
  }

  isolate(h);
  const hound = placeEnemyNear(h, "hound", INSIDE, 0);
  holdCorona(h);
  const full = hpOf(h.snapshot(), hound);

  const first = await advanceTicks(h, 1);
  captureStill(h, "first");

  assertNear(
    hpOf(first, hound),
    full - CORONA_STATS.damage,
    REAL_EPS,
    `the hound's hp after the first tick Corona is held, ${CORONA_STATS.damage} below ${full} (specs/evolutions.md, Corona)`,
  );
});
