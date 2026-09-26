// combos/upgrade-cost — an upgrade spends its fraction of the reference damage.
//
// specs/combinations.md: "Raising a tower one level costs a fraction of its
// reference damage in Charge, rounded to the nearest integer with an exact half
// rounding up", with `COMBO_UPGRADE_COST_FRAC` `[0.8, 1.5, 2.8]` for reaching
// levels `1`, `2` and `3`. The Static Web's reference damage is `34`, so its
// three upgrades cost `round(27.2)` = `27`, `round(51)` = `51` and
// `round(95.2)` = `95`.
//
// The bank is posed well past the whole track, the tower is raised a level at a
// time through the panel's own upgrade operation, and the Charge spent on each
// step is read as the difference. The level is read alongside it, because a
// build that charged correctly and raised nothing would otherwise pass. Charge
// has one other income and one other sink in the whole game — a bounty, a
// wave-clear bonus, and the refinement track (specs/economy.md) — and none of
// them is reachable here: the yard holds one tower, no wave is live, and nothing
// refines the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  COMBO_MAX_LEVEL,
  COMBO_UPGRADE_COST_FRAC,
  comboDef,
  comboUpgradeCost,
} from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  standCombo,
  structureById,
} from "../harness";

const TOWER = comboDef("staticweb");
const ANCHOR = { col: 10, row: 10 };
/** Comfortably past `27 + 51 + 95`, so no step is ever refused for want of Charge. */
const BANK = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spends round(referenceDamage * COMBO_UPGRADE_COST_FRAC) on each level", async () => {
  openYard(h, { charge: BANK });
  const id = standCombo(h, TOWER.id, ANCHOR.col, ANCHOR.row);

  let charge = h.snapshot().charge;
  assertEqual(charge, BANK, "the bank the run was posed with");

  for (let level = 1; level <= COMBO_MAX_LEVEL; level += 1) {
    h.debug.upgradeCombo(id);
    const s = h.snapshot();
    const tower = structureById(s, id);
    assertEqual(tower.level, level, `the ${TOWER.name} reached level ${level}`);
    assertEqual(
      charge - s.charge,
      comboUpgradeCost(TOWER.id, level),
      `reaching level ${level} spends round(${TOWER.damage} * ` +
        `${COMBO_UPGRADE_COST_FRAC[level - 1]})`,
    );
    charge = s.charge;
  }

  await h.advance(1);
  captureStill(h, "cost");
});
