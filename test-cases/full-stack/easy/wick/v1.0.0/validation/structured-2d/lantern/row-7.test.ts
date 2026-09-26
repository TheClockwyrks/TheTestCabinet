// lantern/row-7 — row 7 of `LANTERN_LEVELS` is in force at level 7.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/weapons.md` ("Lantern"), the level table, row 7: damage 20,
//     cooldown 2.5, orbit 110, radius 18, duration 4, amount 3. "Every level
//     table has `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`."
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", "Width, Height, Radius, Orbit, Area" are "table value ×
//     `areaMul`", cooldown is "table value × `cooldownMul`, floored at
//     `MIN_COOLDOWN`", amount is "table value + `amountBonus`", and
//     "Duration" is "table value, unchanged"; with no passive held every
//     multiplier is `1` and the bonus `0` (`specs/passives.md`), so each
//     figure reads its table value.
//   - `specs/weapons.md` ("Lantern"): "On firing, `amount` lanterns appear
//     on a circle of radius `orbit` around the player's center ... Each
//     lantern is a circle of `radius`, and each is a zone with `ttl` set to
//     `duration`."
//   - `specs/world.md` ("One tick"), phase 6, counts down only the zones
//     "that existed before this tick", so on the firing tick each lantern's
//     `ttl` still reads the duration.
//   - `specs/weapons.md` ("Lantern"): "On firing, Lantern's cooldown timer is
//     set to `duration` plus the current cooldown, both read on that tick", so
//     the slot reads 4 + 2.5 = 6.5 on the firing tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy (Lantern
// needs no target) and no passive, the lamplighter posed off the origin,
// Lantern held at level 7 with its timer at `0`, and `weaponFire` the one
// switch on. The firing tick runs once: 3 lantern zones of radius 18 with
// damage 20 and ttl 4, each standing 110 from the lamplighter's center, and
// the slot's timer reads 6.5. Where on the circle each lantern starts is the
// placement check's point, and how they turn is the revolution check's.
//
// THE TOLERANCE. `REAL_EPS` on each figure, a table value times a multiplier
// of `1` or copied unchanged, and on the orbit, which the build reaches by
// one sine and one cosine; the lantern count is exact. The nearest rows differ
// by at least 5 damage, 0.5 of cooldown, 10 of orbit, 2 of radius, 0.5 of
// duration, or 1 of amount, all far outside the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { LANTERN_LEVELS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { POSED, fireLantern, orbitOf } from "./set";

/** The row under test. */
const LEVEL = 7;
const ROW = LANTERN_LEVELS[LEVEL - 1];

/** What the firing leaves on the slot's timer: `duration` plus the cooldown. */
const TIMER = ROW.duration + ROW.cooldown;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 3 lanterns of radius 18, damage 20, and ttl 4 on a circle of radius 110, and sets the timer to 6.5 at level 7", async () => {
  const firing = await fireLantern(h, LEVEL, POSED);
  captureStill(h, "row");

  assertEqual(
    firing.lanterns.length,
    ROW.amount,
    `the lanterns the firing tick created at level ${LEVEL} (specs/weapons.md, Lantern)`,
  );
  for (const lantern of firing.lanterns) {
    assertNear(
      lantern.radius,
      ROW.radius,
      REAL_EPS,
      `lantern ${lantern.id}'s radius at level ${LEVEL}`,
    );
    assertNear(
      lantern.damage,
      ROW.damage,
      REAL_EPS,
      `lantern ${lantern.id}'s damage at level ${LEVEL}`,
    );
    assertNear(
      lantern.ttl ?? Number.NaN,
      ROW.duration,
      REAL_EPS,
      `lantern ${lantern.id}'s ttl on the firing tick at level ${LEVEL}`,
    );
    assertNear(
      orbitOf(firing.after, lantern),
      ROW.orbit,
      REAL_EPS,
      `lantern ${lantern.id}'s distance from the lamplighter's center at level ${LEVEL}`,
    );
  }
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    TIMER,
    REAL_EPS,
    `Lantern's timer after the firing at level ${LEVEL}, its duration plus its cooldown`,
  );
});
