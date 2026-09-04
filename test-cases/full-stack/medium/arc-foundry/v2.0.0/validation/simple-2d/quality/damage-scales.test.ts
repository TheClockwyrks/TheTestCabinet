// quality/damage-scales — damage is the base damage times QUALITY_MULT[tier].
//
// specs/components.md fixes the rule and then writes the whole table out:
// "Damage: `baseDamage * QUALITY_MULT[tier]`, where `QUALITY_MULT` is
// `[1, 3, 9, 40, 110]`", with a row per firing type and a column per tier. Every
// figure here is that table, computed from the same two constants rather than
// copied, so a build is held to the rule and to the base stats together.
//
// The seven firing types are stood one type at a time, five tiers of it at once
// and nothing else on the yard. Nothing that carries an aura is ever standing, so
// the `damage` the snapshot reports — which is "the structure's effective per-shot
// damage, including any aura buff on it" (specs/instrumentation.md) — is the bare
// figure the ladder scales. The Regulator is not here: it has no damage row, and
// its own points are in the abilities category.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  componentDamage,
  createHarness,
  emptyYard,
  FIRING_TYPES,
  openYard,
  standComponent,
  structureById,
  TIERS,
  type Harness,
} from "../harness";

/** One anchor per tier, each footprint two tiles clear of the next. */
const ANCHORS = [8, 12, 16, 20, 24].map((col) => ({ col, row: 10 }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports baseDamage * QUALITY_MULT[tier] at every tier of every firing type", async () => {
  openYard(h);

  for (const type of FIRING_TYPES) {
    emptyYard(h);
    const ids: number[] = [];
    for (const [index, tier] of TIERS.entries()) {
      const anchor = ANCHORS[index]!;
      ids.push(standComponent(h, type, tier, anchor.col, anchor.row));
    }

    const yard = h.snapshot();
    for (const [index, tier] of TIERS.entries()) {
      assertCloseTo(
        structureById(yard, ids[index]!).damage,
        componentDamage(type, tier),
        6,
        `the ${type}'s damage at tier ${tier} (specs/components.md)`,
      );
    }
  }

  await h.advance(1);
  captureStill(h, "ladder");
});
