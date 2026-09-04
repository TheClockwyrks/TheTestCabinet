// combos/recipe-assembles — a recipe folds into its combination tower.
//
// specs/scrap-press.md: a recipe-combine folds the exact multiset of base
// `(type, quality)` ingredients a tower's recipe demands into that tower; the
// tower lands at the initiating piece's footprint at level `0`, and every
// consumed footprint hardens into a blocker. specs/combinations.md fixes the
// Static Web's recipe as `coil@1` + `capacitor@1` + `choke@1` and its reference
// block as range `120`, rate `1.2` /s and damage `34`, with `chain` and `slow`.
//
// The three ingredients are stood up as standing components and folded through
// an explicit combine set, which specs/scrap-press.md fixes as folding exactly
// the pieces in that set. What is read back is the structure at the INITIATING
// anchor: a combination tower of that identifier, carrying no quality tier, at
// level `0`, with the reference block scaled by `COMBO_DAMAGE_MULT[0]` and
// `COMBO_RANGE_BONUS[0]`. The two other footprints are read too, because a
// combine that freed them would have opened a hole in the maze.
//
// No aura reaches the result: the yard holds nothing else, and the Static Web
// carries no aura of its own, so the damage read here is the tower's own.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { COMBO_DAMAGE_MULT, COMBO_RANGE_BONUS } from "../../src/constants";
import {
  captureStill,
  comboDamage,
  comboDef,
  comboRange,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { abilityNames, anchored, rowAbilities, tierOf } from "./towers";

/** The tower this check assembles, and the three anchors its recipe is stood on. */
const TOWER = comboDef("staticweb");
const INITIATOR = { col: 10, row: 10 };
const SECOND = { col: 14, row: 10 };
const THIRD = { col: 18, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("folds a recipe's exact ingredients into its tower at the initiating footprint", async () => {
  openYard(h);
  const first = standComponent(
    h,
    TOWER.recipe[0]!.type,
    tierOf(TOWER.recipe[0]!),
    INITIATOR.col,
    INITIATOR.row,
  );
  const second = standComponent(
    h,
    TOWER.recipe[1]!.type,
    tierOf(TOWER.recipe[1]!),
    SECOND.col,
    SECOND.row,
  );
  const third = standComponent(
    h,
    TOWER.recipe[2]!.type,
    tierOf(TOWER.recipe[2]!),
    THIRD.col,
    THIRD.row,
  );

  // The explicit set is the three ingredients, initiated from the first:
  // `select` clears the set back to that single selection, and each `add` puts
  // one more base structure in it (specs/instrumentation.md).
  h.debug.select(first);
  h.debug.addToCombineSet(second);
  h.debug.addToCombineSet(third);
  h.debug.combine(first);

  await h.advance(1);
  captureStill(h, "assemble");

  const s = h.snapshot();
  const tower = anchored(s, INITIATOR.col, INITIATOR.row);
  assertEqual(tower.kind, "combo", "the fold's result is a combination tower");
  assertEqual(tower.type, TOWER.id, `the ${TOWER.name} the recipe names`);
  assertEqual(tower.quality, null, "a combination tower has no quality tier");
  assertEqual(tower.level, 0, "a landed tower is at level 0");
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
  assertCloseTo(tower.fireRate, TOWER.fireRate, 6, "the reference fire rate");
  assertEqual(
    abilityNames(tower).join(", "),
    rowAbilities(TOWER).join(", "),
    `the ${TOWER.name}'s abilities`,
  );

  // Wall-neutral: the two consumed footprints hardened into blockers rather
  // than being freed (specs/scrap-press.md).
  assertEqual(
    anchored(s, SECOND.col, SECOND.row).kind,
    "blocker",
    "the consumed footprint hardens into a blocker",
  );
  assertEqual(
    anchored(s, THIRD.col, THIRD.row).kind,
    "blocker",
    "the consumed footprint hardens into a blocker",
  );
  assertLength(s.structures, 3, "one tower and two hardened footprints");
});
