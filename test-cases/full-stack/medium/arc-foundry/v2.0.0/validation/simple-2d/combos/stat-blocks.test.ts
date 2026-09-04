// combos/stat-blocks — each of the twelve carries the row COMBOS gives it.
//
// specs/combinations.md fixes twelve towers by identifier, and for each a
// reference block of range, fire rate per second, damage and abilities, "the
// figures a level-`3` tower scales toward". So every tower is stood at level `3`
// and every figure the snapshot reports for it is held against its own row:
// `referenceRange + COMBO_RANGE_BONUS[3]` (`+12`), the flat reference fire rate,
// `referenceDamage * COMBO_DAMAGE_MULT[3]` (`* 1.02`), the ability names, and —
// for the three towers that carry one — the aura's radius and bonus, which
// specs/instrumentation.md reports as `auraRadius` and `auraBonus`.
//
// THE TWELVE STAND AT ONCE, AND FAR APART. An aura buffs "every firing structure
// whose center lies within `auraRadius` of the source" and the widest is the Null
// Core's `100`, so the anchors below put `260` units between neighbouring
// columns and `200` between rows: no tower is inside another's aura, and the
// `damage` each reports is its own rather than a buffed one. Every anchor is
// clear of the Substation's six waypoint platforms, of its entry and of its
// collector.
//
// The ability PARAMETERS the snapshot does not report — a splash radius, a
// chain's leaps, a slow's amount, a burn's fraction, a crit's chance, a
// multishot's `N` — are decided where they act, by the `abilities` checks and by
// the sibling `crit` and `multishot` checks here.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { COMBO_MAX_LEVEL, comboDamage, comboRange, COMBOS } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  standCombo,
  structureById,
} from "../harness";
import { abilityNames, rowAbilities } from "./towers";

/**
 * Twelve anchors, four columns by three rows.
 *
 * Column centers are `260` units apart and row centers `200`, both past the
 * widest aura in the table, so nothing here buffs anything else here.
 */
const COLS = [4, 17, 30, 43];
const ROWS = [8, 18, 28];

/**
 * The aura a row names, or the resting reading for a tower that carries none.
 *
 * `specs/instrumentation.md` fixes `auraRadius` and `auraBonus` as the aura a
 * structure projects, and a structure that projects none reports `0` for both
 * rather than going missing.
 */
const NO_AURA = { radius: 0, bonus: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports every tower's reference block, scaled to its level", async () => {
  openYard(h);

  const placed = new Map<string, number>();
  for (const [index, tower] of COMBOS.entries()) {
    const col = COLS[index % COLS.length]!;
    const row = ROWS[Math.floor(index / COLS.length)]!;
    placed.set(tower.id, standCombo(h, tower.id, col, row, COMBO_MAX_LEVEL));
  }

  await h.advance(1);
  captureStill(h, "twelve");

  const s = h.snapshot();
  for (const tower of COMBOS) {
    const view = structureById(s, placed.get(tower.id)!);
    assertEqual(view.level, COMBO_MAX_LEVEL, `${tower.name} at its top level`);
    assertCloseTo(
      view.range,
      comboRange(tower.id, COMBO_MAX_LEVEL),
      6,
      `${tower.name}: ${tower.range} + COMBO_RANGE_BONUS[3]`,
    );
    assertCloseTo(
      view.fireRate,
      tower.fireRate,
      6,
      `${tower.name}: the reference rate, flat across level`,
    );
    assertCloseTo(
      view.damage,
      comboDamage(tower.id, COMBO_MAX_LEVEL),
      6,
      `${tower.name}: ${tower.damage} * COMBO_DAMAGE_MULT[3]`,
    );
    assertEqual(
      abilityNames(view).join(", "),
      rowAbilities(tower).join(", "),
      `${tower.name}: the abilities its row names`,
    );
    const aura = tower.abilities.aura ?? NO_AURA;
    assertCloseTo(
      view.auraRadius,
      aura.radius,
      6,
      `${tower.name}: the aura radius its row names`,
    );
    assertCloseTo(
      view.auraBonus,
      aura.bonus,
      6,
      `${tower.name}: the aura bonus its row names`,
    );
  }
});
