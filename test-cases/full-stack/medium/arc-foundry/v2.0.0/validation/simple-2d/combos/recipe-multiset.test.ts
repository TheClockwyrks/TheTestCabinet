// combos/recipe-multiset — a recipe counts its ingredients as a multiset.
//
// specs/combinations.md: "A recipe is an exact multiset of base `(type, tier)`
// ingredients. The Singularity's recipe calls for two Arc-Nodes at different
// tiers, and a recipe is satisfied only when the yard holds every ingredient it
// lists, counted as a multiset." The Singularity is `arcnode@5` +
// `regulator@4` + `rectifier@2` + `arcnode@2`, and it is the one recipe that
// names a type twice.
//
// The yard is posed with three of the four, holding one Arc-Node where the
// recipe wants two, and the inspector's recipe rows are read: none, because no
// recipe in the table is satisfied by that set. The second Arc-Node is then
// stood up at the OTHER tier the recipe names, and the rows are read again: one,
// labelled with the tower it would build (specs/instrumentation.md fixes a
// `combine-special` row's label as naming that tower). Committing it produces
// the Singularity, so what the row offered is what the fold builds.
//
// The two Arc-Nodes stand at different tiers throughout, so no quality-fold is
// ever available and the rows read here can only be recipe rows.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  comboDef,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import {
  anchored,
  letters,
  offeredFolds,
  offeredRecipes,
  tierOf,
} from "./towers";

const TOWER = comboDef("singularity");
/** The recipe's four ingredients, the repeated Arc-Node last. */
const [FIRST, SECOND, THIRD, REPEAT] = [
  TOWER.recipe[0]!,
  TOWER.recipe[1]!,
  TOWER.recipe[2]!,
  TOWER.recipe[3]!,
];
const ANCHORS = [
  { col: 10, row: 10 },
  { col: 14, row: 10 },
  { col: 18, row: 10 },
  { col: 22, row: 10 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reaches the Singularity only once both of its Arc-Nodes stand", async () => {
  openYard(h);
  const first = standComponent(
    h,
    FIRST.type,
    tierOf(FIRST),
    ANCHORS[0]!.col,
    ANCHORS[0]!.row,
  );
  const second = standComponent(
    h,
    SECOND.type,
    tierOf(SECOND),
    ANCHORS[1]!.col,
    ANCHORS[1]!.row,
  );
  const third = standComponent(
    h,
    THIRD.type,
    tierOf(THIRD),
    ANCHORS[2]!.col,
    ANCHORS[2]!.row,
  );

  // Three of the four ingredients: the multiset is one Arc-Node short.
  h.debug.select(first);
  assertLength(
    offeredRecipes(h.debug.panelButtons()),
    0,
    "no recipe is satisfied while the Singularity is an Arc-Node short",
  );

  const repeat = standComponent(
    h,
    REPEAT.type,
    tierOf(REPEAT),
    ANCHORS[3]!.col,
    ANCHORS[3]!.row,
  );
  h.debug.select(first);
  await h.advance(1);
  captureStill(h, "multiset");

  const rows = offeredRecipes(h.debug.panelButtons());
  assertLength(rows, 1, "the completed multiset offers exactly one recipe");
  assertContains(
    letters(rows[0]!.label),
    letters(TOWER.name),
    `the row names the ${TOWER.name} it would build`,
  );
  // The two Arc-Nodes are at different tiers, so nothing here is a quality fold.
  assertLength(
    offeredFolds(h.debug.panelButtons()),
    0,
    "two Arc-Nodes at different tiers are not a matching pair",
  );

  h.debug.select(first);
  h.debug.addToCombineSet(second);
  h.debug.addToCombineSet(third);
  h.debug.addToCombineSet(repeat);
  h.debug.combine(first);

  const tower = anchored(h.snapshot(), ANCHORS[0]!.col, ANCHORS[0]!.row);
  assertEqual(tower.kind, "combo", "the fold's result is a combination tower");
  assertEqual(tower.type, TOWER.id, `the ${TOWER.name} the multiset names`);
});
