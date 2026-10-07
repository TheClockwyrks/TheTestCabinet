// evolutions/chandelier-row — CHANDELIER_STATS is in force.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/evolutions.md` ("Chandelier"), `CHANDELIER_STATS`: damage 25,
//     orbit 120, radius 20, amount 4.
//   - `specs/evolutions.md` ("Chandelier"): "`amount` Chandelier lanterns are
//     created, each a zone of kind `lantern` with `ttl` `null`, a fresh id,
//     and empty `hits`, on a circle of radius `orbit` centered on the player's
//     center".
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", "every width, height, radius, and orbit is
//     the fixed length times `areaMul`", and amount is "the fixed amount plus
//     `amountBonus`". No passive is held, so every multiplier is 1 and the
//     bonus 0 (`specs/passives.md`).
//   - `specs/state.md` (`ZoneState`): `ttl` is "`null` for a zone that never
//     expires: an aura, and a Chandelier lantern".
//
// WHY NO SWITCH IS TURNED ON. The set arrives through the PLACEMENT part of
// phase 5, which `specs/instrumentation.md` ("The driver switches") states
// runs "on every `playing` tick, whatever the two hold" — so holding
// Chandelier and running one tick is the whole arrangement, and a build that
// gated placement behind `weaponFire` fails here.
//
// WHY THE LAMPLIGHTER IS POSED OFF THE ORIGIN. A fresh run stands it at
// `(0, 0)`, where a circle laid about the world origin and one laid about the
// lamplighter's center would read the same; `POSED` is neither the origin nor
// on either axis, so the orbit read is a distance from the LAMPLIGHTER.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but
// Chandelier, every driver switch off, so no other weapon places anything and
// nothing moves the set before it is read. WHERE on the circle each lantern
// starts is `chandelier-replaces-lantern-set`'s point; the row holds whatever
// angles they took.
//
// THE TOLERANCE. `REAL_EPS` on each figure, a row value times a multiplier of
// 1, and on the orbit, which the build reaches through one sine and one
// cosine; the count, the kind and the null `ttl` are read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNull } from "../assert";
import { CHANDELIER_STATS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { POSED, orbitOf, placeChandelier } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("places four lanterns of radius 20 and damage 25 on a circle of radius 120, each with ttl null", async () => {
  const placed = await placeChandelier(h, POSED);
  captureStill(h, "row");

  assertEqual(
    placed.lanterns.length,
    CHANDELIER_STATS.amount,
    "the Chandelier lanterns standing after the placing tick (specs/evolutions.md, Chandelier)",
  );
  for (const lantern of placed.lanterns) {
    assertEqual(
      lantern.kind,
      "lantern",
      `zone ${lantern.id}'s kind (specs/state.md, ZoneState)`,
    );
    assertNear(
      lantern.radius,
      CHANDELIER_STATS.radius,
      REAL_EPS,
      `lantern ${lantern.id}'s radius (specs/evolutions.md, CHANDELIER_STATS)`,
    );
    assertNear(
      lantern.damage,
      CHANDELIER_STATS.damage,
      REAL_EPS,
      `lantern ${lantern.id}'s damage (specs/evolutions.md, CHANDELIER_STATS)`,
    );
    assertNear(
      orbitOf(placed.after, lantern),
      CHANDELIER_STATS.orbit,
      REAL_EPS,
      `lantern ${lantern.id}'s distance from the lamplighter's center (specs/evolutions.md, CHANDELIER_STATS)`,
    );
    assertNull(
      lantern.ttl,
      `lantern ${lantern.id}'s ttl, which never expires (specs/state.md, ZoneState)`,
    );
  }
});
