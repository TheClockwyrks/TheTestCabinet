// lantern/row-2 — row 2 of `LANTERN_LEVELS` is in force at level 2.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/weapons.md` ("Lantern"), the level table, row 2: damage 10,
//     cooldown 3, orbit 90, radius 14, duration 3, amount 2. "Every level
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
//     the slot reads 3 + 3 = 6 on the firing tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy (Lantern
// needs no target) and no passive, the lamplighter posed off the origin,
// Lantern held at level 2 with its timer at `0`, and `weaponFire` the one
// switch on. The firing tick runs once: 2 lantern zones of radius 14 with
// damage 10 and ttl 3, each standing 90 from the lamplighter's center, and the
// slot's timer reads 6. Where on the circle each lantern starts is the
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
const LEVEL = 2;
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

it("creates 2 lanterns of radius 14, damage 10, and ttl 3 on a circle of radius 90, and sets the timer to 6 at level 2", async () => {
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
