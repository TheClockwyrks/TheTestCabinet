// combos/range-by-level — reach climbs the track by COMBO_RANGE_BONUS.
//
// specs/combinations.md fixes a landed tower's range as `referenceRange +
// COMBO_RANGE_BONUS[level]`, with `COMBO_RANGE_BONUS` `[0, 4, 8, 12]`, so a Fork
// Array's `118` reads `118`, `122`, `126` and `130` across its track. The bonus
// is an addition rather than a multiplier, which is what this check separates: a
// build that scaled range the way it scales damage reads `59` at level `0`.
//
// Two towers are read at all four levels, one of long reach and one of short, so
// a build that applied a fraction rather than the flat bonus fails on both
// rather than only where the arithmetic happens to agree. Each stands alone: an
// aura changes damage alone and never range (specs/components.md), but an empty
// yard leaves nothing to argue about.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  COMBO_LEVELS,
  COMBO_RANGE_BONUS,
  comboDef,
  comboRange,
  type ComboId,
} from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCombo,
  structureById,
  type Harness,
} from "../harness";

const TOWERS: ComboId[] = ["forkarray", "auroralance"];
const ANCHOR = { col: 10, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports referenceRange + COMBO_RANGE_BONUS[level] at each of the four levels", async () => {
  await openYard(h);

  for (const id of TOWERS) {
    const tower = comboDef(id);
    const placed = await standCombo(h, id, ANCHOR.col, ANCHOR.row);
    for (const level of COMBO_LEVELS) {
      await h.debug.setComboLevel(placed, level);
      const view = structureById(await h.snapshot(), placed);
      assertCloseTo(
        view.range,
        comboRange(id, level),
        6,
        `${tower.name} at level ${level}: ${tower.range} + ` +
          `COMBO_RANGE_BONUS[${level}] (${COMBO_RANGE_BONUS[level]})`,
      );
    }
    await h.advance(1);
    await captureStill(h, "levels");
    await h.debug.dismantle(placed);
  }
});
