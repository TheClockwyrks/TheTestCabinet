// Wick — halo/radius-per-tick: the aura's radius follows the level in force on
// each tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Halo"): "its `radius` and `damage` are recomputed on
//     every tick from the level, `areaMul`, and `damageMul` in force on that
//     tick"; level 1 has radius `80` and level 2 radius `90`.
//   - `specs/state.md` (`ZoneState.radius`): "It is fixed when the zone is
//     created, except on an aura and a Chandelier lantern, where it is
//     recomputed on every tick from the level and the area multiplier in force
//     on that tick."
//   - `specs/world.md` ("One tick"), phase 5, the placement, on every `playing`
//     tick: "the aura's radius and damage ... are recomputed from the level,
//     `areaMul`, and `damageMul` in force".
//   - `specs/instrumentation.md` (`setWeapon`): puts the weapon "at `level` in
//     `slot`", and "when only the level changes the timer keeps counting";
//     ("The driver switches") "Placement is gated by neither `weaponFire` nor
//     `effectMotion`".
//   - `specs/weapons.md` ("Derived stats"): radius is the "table value ×
//     `areaMul`", `1` with no Glass held (`specs/passives.md`).
//
// WHAT IS READ. The aura's `radius` after the first tick at level 1, 80, and
// after the one tick that follows raising Halo to level 2 in its slot, 90. A
// build that fixes the radius when the aura is created still reads 80 on the
// second reading.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone, nothing on the field, every
// switch off: the placement runs whatever the switches hold, nothing pulses,
// and no passive scales the figure, so the radius read is the row's alone.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each radius: a stated figure times a
// multiplier of 1, read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, derived } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { haloRow, poseHalo, theAura } from "./aura";

/** The level Halo is held at first, and the one it rises to. */
const FIRST_LEVEL = 1;
const SECOND_LEVEL = 2;

/** Each level's radius with no Glass held: row radius × 1. */
const FIRST_RADIUS = haloRow(FIRST_LEVEL).radius * derived.areaMul({});
const SECOND_RADIUS = haloRow(SECOND_LEVEL).radius * derived.areaMul({});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads radius 80 at level 1 and 90 on the tick after Halo rises to level 2", async () => {
  const { slot } = poseHalo(h, FIRST_LEVEL, null);

  const atFirst = await h.tick(1);
  assertWithin(
    theAura(atFirst, "after the first tick at level 1").radius,
    FIRST_RADIUS,
    FIGURE_TOLERANCE,
    "the aura's radius at level 1",
  );

  h.debug.setWeapon(slot, "halo", SECOND_LEVEL);
  assertEqual(
    h.snapshot().run.weapons[slot]?.level,
    SECOND_LEVEL,
    "Halo's level after the rise",
  );

  const atSecond = await h.tick(1);
  captureStill(h, "resized");
  assertWithin(
    theAura(atSecond, "after the tick following the rise to level 2").radius,
    SECOND_RADIUS,
    FIGURE_TOLERANCE,
    "the aura's radius at level 2",
  );
});
