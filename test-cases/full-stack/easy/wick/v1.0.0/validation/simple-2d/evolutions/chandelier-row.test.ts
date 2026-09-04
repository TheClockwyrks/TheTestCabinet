// Wick — evolutions/chandelier-row: `CHANDELIER_STATS` is in force.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Chandelier"), the fixed row `CHANDELIER_STATS`:
//     damage `25`, orbit `120`, radius `20`, amount `4`.
//   - `specs/evolutions.md` ("Chandelier"): "On the first `playing` tick
//     Chandelier is held and no Chandelier lantern exists ... `amount`
//     Chandelier lanterns are created, each a zone of kind `lantern` with `ttl`
//     `null`, a fresh id, and empty `hits`, on a circle of radius `orbit`
//     centered on the player's center".
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`" and "every width, height, radius, and orbit is
//     the fixed length times `areaMul`"; with no passive held every multiplier
//     is `1` and `amountBonus` is `0` (`specs/passives.md`).
//   - `specs/world.md` ("One tick"), phase 5: "The placement, on every
//     `playing` tick: an aura or a lantern set is created on a tick its weapon
//     is held and none exists"; `specs/instrumentation.md` (The driver
//     switches): "Placement is gated by neither `weaponFire` nor
//     `effectMotion`", so the set appears with every switch off.
//   - `specs/state.md` (`ZoneState`): `ttl` is "`null` for a zone that never
//     expires".
//
// WHAT IS READ. After the first `playing` tick Chandelier is held: four zones
// of kind `lantern` with weapon `chandelier`, each of radius 20 and damage 25,
// each `orbit` 120 from the lamplighter's center, and each with `ttl` `null`.
// Every figure of the row is asserted, so a build whose fixed row departs from
// the specification in any column fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Chandelier alone, no passive held, nothing
// on the field, every driver switch off: the placement needs none of them, so
// the zones read are the set alone, every figure is the fixed row's unscaled,
// and `effectMotion` off holds each lantern where the placement put it.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, and the orbit distance, each
// a stated figure or a stated figure times a multiplier of 1, read back. None
// on the count or on `ttl`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertWithin } from "../assert";
import { CHANDELIER_STATS, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  type Harness,
} from "../harness";
import { poseEvolved } from "./evolved";
import { chandelierLanterns } from "./chandelier";

/** Chandelier's fixed row. */
const ROW = CHANDELIER_STATS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates four lanterns of radius 20 and damage 25 on a circle of radius 120", async () => {
  const { player } = poseEvolved(h, "chandelier");

  const after = await h.tick(1);
  captureStill(h, "row");

  const set = chandelierLanterns(after);
  assertEqual(set.length, ROW.amount, "Chandelier lanterns after the tick");
  for (const lantern of set) {
    const which = `lantern ${lantern.id}`;
    assertWithin(
      lantern.radius,
      ROW.radius,
      FIGURE_TOLERANCE,
      `${which}: radius`,
    );
    assertWithin(
      lantern.damage,
      ROW.damage,
      FIGURE_TOLERANCE,
      `${which}: damage`,
    );
    assertWithin(
      distance(player, lantern),
      ROW.orbit,
      FIGURE_TOLERANCE,
      `${which}: distance from the lamplighter's center, the orbit`,
    );
    assertNull(lantern.ttl, `${which}: ttl, which never expires`);
  }
});
