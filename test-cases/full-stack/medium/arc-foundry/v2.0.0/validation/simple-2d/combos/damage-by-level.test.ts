// combos/damage-by-level — damage climbs the track by COMBO_DAMAGE_MULT.
//
// specs/combinations.md fixes a landed tower's damage as `referenceDamage *
// COMBO_DAMAGE_MULT[level]`, with `COMBO_DAMAGE_MULT` `[0.5, 0.63, 0.78, 1.02]`,
// and states no rounding for it: the upgrade cost and the per-wave health
// scaling each say where they round, and this rule does not.
//
// Two towers are read across all four levels. The Fork Array's reference `100`
// makes every product a whole number, and the Static Web's `34` makes none of
// them one — `21.42`, `26.52`, `34.68` — so a build that rounds the product to
// an integer fails here rather than passing on a tower whose figures happen to
// be whole. Each tower stands alone on an otherwise empty yard, so the reported
// damage carries no aura and is the tower's own.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  COMBO_DAMAGE_MULT,
  COMBO_LEVELS,
  comboDamage,
  comboDef,
  type ComboId,
} from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  standCombo,
  structureById,
} from "../harness";

/** One tower whose products are whole, and one whose products are not. */
const TOWERS: ComboId[] = ["forkarray", "staticweb"];
const ANCHOR = { col: 10, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports referenceDamage * COMBO_DAMAGE_MULT[level] at each of the four levels", async () => {
  openYard(h);

  for (const id of TOWERS) {
    const tower = comboDef(id);
    const placed = standCombo(h, id, ANCHOR.col, ANCHOR.row);
    for (const level of COMBO_LEVELS) {
      h.debug.setComboLevel(placed, level);
      const view = structureById(h.snapshot(), placed);
      assertCloseTo(
        view.damage,
        comboDamage(id, level),
        6,
        `${tower.name} at level ${level}: ${tower.damage} * ` +
          `COMBO_DAMAGE_MULT[${level}] (${COMBO_DAMAGE_MULT[level]})`,
      );
    }
    await h.advance(1);
    captureStill(h, "levels");
    h.debug.dismantle(placed);
  }
});
