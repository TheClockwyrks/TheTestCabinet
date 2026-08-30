// combos/lands-at-level-zero — a newly landed tower sits at the bottom of its track.
//
// specs/combinations.md: a combination tower "lands at level `0` and is raised a
// level at a time for Charge", and a landed tower's live stats derive from its
// reference block and its level, `referenceDamage * COMBO_DAMAGE_MULT[level]`
// and `referenceRange + COMBO_RANGE_BONUS[level]`. At level `0` those are `0.5`
// and `0`, so the Fork Array's reference `100` damage and `118` range land at
// `50` and `118`.
//
// The tower is stood up directly and read on the frame it lands: its level, its
// damage and its range. The yard holds nothing else, so no aura is on the damage
// figure and the Fork Array carries none of its own. The multiplier at each of
// the four levels is the sibling `damage-by-level` check; this one decides only
// where a tower LANDS.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  COMBO_DAMAGE_MULT,
  COMBO_RANGE_BONUS,
  comboDamage,
  comboDef,
  comboRange,
} from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCombo,
  structureById,
  type Harness,
} from "../harness";

const TOWER = comboDef("forkarray");
const ANCHOR = { col: 10, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lands a tower at level 0, at half its reference damage and its reference range", async () => {
  await openYard(h);
  const id = await standCombo(h, TOWER.id, ANCHOR.col, ANCHOR.row);

  await h.advance(1);
  await captureStill(h, "landed");

  const tower = structureById(await h.snapshot(), id);
  assertEqual(tower.level, 0, `a landed ${TOWER.name} is at level 0`);
  assertCloseTo(
    tower.damage,
    comboDamage(TOWER.id, 0),
    6,
    `${TOWER.damage} * COMBO_DAMAGE_MULT[0] (${COMBO_DAMAGE_MULT[0]})`,
  );
  assertCloseTo(
    tower.range,
    comboRange(TOWER.id, 0),
    6,
    `${TOWER.range} + COMBO_RANGE_BONUS[0] (${COMBO_RANGE_BONUS[0]})`,
  );
});
