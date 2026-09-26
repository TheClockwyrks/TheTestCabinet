// abilities/aura-damage-only — an aura moves damage and nothing else.
//
// specs/components.md fixes the reach of the buff: an aura "changes damage alone:
// range, cadence, and every ability parameter are untouched by it". A build that
// lets an aura widen a radius or quicken a cadence changes what a yard of towers
// covers, which is a different game from one where a Regulator is a damage
// multiplier.
//
// One Choke is stood alone and every figure it reports is recorded. A Tesla-Prime
// Regulator — the strongest aura in the game, so the largest chance for something
// else to move with it — is then stood inside its radius, and the Choke is read
// again. The Choke is the type chosen because it carries an ability with
// parameters of its own, so `abilities` is not an empty list that could not have
// changed. Everything but the damage must come back identical, and the damage must
// come back as exactly the bare figure times one plus the bonus.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual } from "../assert";
import { componentDamage, REGULATOR_AURA } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  standComponent,
  structureById,
  type StructureView,
} from "../harness";

/** Centres sixty apart, inside a Tesla-Prime Regulator's `114`. */
const CHOKE = { col: 20, row: 15 };
const REGULATOR = { col: 17, row: 15 };

/** The tiers this is read at. */
const CHOKE_TIER = 3;
const REGULATOR_TIER = 5;

/** Everything about the structure that the aura must leave exactly as it was. */
function untouched(structure: StructureView): unknown {
  return {
    kind: structure.kind,
    type: structure.type,
    quality: structure.quality,
    level: structure.level,
    col: structure.col,
    row: structure.row,
    cx: structure.cx,
    cy: structure.cy,
    range: structure.range,
    fireRate: structure.fireRate,
    targeting: structure.targeting,
    auraRadius: structure.auraRadius,
    auraBonus: structure.auraBonus,
    abilities: [...structure.abilities],
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves range, cadence and every ability of a buffed structure where they were", async () => {
  openYard(h);
  const id = standComponent(h, "choke", CHOKE_TIER, CHOKE.col, CHOKE.row);
  const before = structureById(h.snapshot(), id);

  standComponent(h, "regulator", REGULATOR_TIER, REGULATOR.col, REGULATOR.row);
  await h.advance(1);
  captureStill(h, "damage");
  const after = structureById(h.snapshot(), id);

  const bonus = REGULATOR_AURA[REGULATOR_TIER - 1]!.bonus;
  assertCloseTo(
    after.damage,
    componentDamage("choke", CHOKE_TIER) * (1 + bonus),
    6,
    `the damage the buffed structure reports, so the aura really did reach it ` +
      `(a bonus of ${bonus})`,
  );
  assertDeepEqual(
    untouched(after),
    untouched(before),
    "every reported figure of the structure other than its damage, with a " +
      "Regulator beside it and without one (specs/components.md)",
  );
});
