// combos/never-an-ingredient — a combination tower is never folded into anything.
//
// specs/combinations.md: a combination tower "is not a base structure: it cannot
// be quality-combined, and it is never an ingredient in another recipe."
// specs/scrap-press.md says the same from the press's side: a quality-combine
// "only ever folds a same-type, same-quality pair" of BASE structures, and a
// recipe-combine folds "the exact multiset of base `(type, quality)`
// ingredients" a tower's recipe demands.
//
// Both halves are posed. Two identical towers stand side by side, which is the
// closest thing to a matching pair the game can hold, and the inspector offers
// no fold on either; a combine committed anyway leaves both standing. Then a
// Static Web — a tower BUILT FROM a `coil@1` — stands beside the other two
// ingredients of its own recipe, so a build that let the tower stand in for the
// coil it was made of would offer that recipe. None is offered.
//
// The yard holds nothing else in either half, so a row that did appear could
// only be about the pieces this check placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  comboDef,
  createHarness,
  emptyYard,
  openYard,
  standCombo,
  standComponent,
  structureById,
  type Harness,
} from "../harness";
import { offeredFolds, offeredRecipes, tierOf } from "./towers";

/** The pair, and the tower whose own recipe is rebuilt around it. */
const PAIR = comboDef("fusecluster");
const REBUILT = comboDef("staticweb");
const FIRST = { col: 10, row: 10 };
const SECOND = { col: 14, row: 10 };
const THIRD = { col: 18, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("offers no fold on a pair of towers and lets no tower satisfy a recipe", async () => {
  openYard(h);

  // Two identical towers at the same level: a matching pair, if a tower could be one.
  const first = standCombo(h, PAIR.id, FIRST.col, FIRST.row);
  const second = standCombo(h, PAIR.id, SECOND.col, SECOND.row);
  h.debug.select(first);
  await h.advance(1);
  captureStill(h, "refused");

  const drawn = h.debug.panelButtons();
  assertLength(
    offeredFolds(drawn),
    0,
    `two ${PAIR.name}s offer no quality fold`,
  );
  assertLength(offeredRecipes(drawn), 0, `two ${PAIR.name}s satisfy no recipe`);

  // Committed with no explicit set, because `addToCombineSet` takes a BASE
  // structure alone and a combination tower is not one: with the set empty the
  // game resolves the ingredients itself from the yard (specs/scrap-press.md),
  // which is the path that would find the pair if a pair is what it is.
  h.debug.clearCombineSet();
  h.debug.combine(first);

  const folded = h.snapshot();
  assertLength(folded.structures, 2, "neither tower was consumed");
  assertEqual(
    structureById(folded, first).type,
    PAIR.id,
    "the initiating tower is unchanged",
  );
  assertEqual(
    structureById(folded, first).level,
    0,
    "the initiating tower's level is unchanged",
  );
  assertEqual(
    structureById(folded, second).type,
    PAIR.id,
    "the second tower is unchanged",
  );

  // A tower built from a `coil@1`, beside that recipe's other two ingredients.
  emptyYard(h);
  standCombo(h, REBUILT.id, FIRST.col, FIRST.row);
  const ingredient = standComponent(
    h,
    REBUILT.recipe[1]!.type,
    tierOf(REBUILT.recipe[1]!),
    SECOND.col,
    SECOND.row,
  );
  standComponent(
    h,
    REBUILT.recipe[2]!.type,
    tierOf(REBUILT.recipe[2]!),
    THIRD.col,
    THIRD.row,
  );

  // Selected from a piece that IS an ingredient, so a build that let the tower
  // stand in for the third would have a reachable recipe to offer here.
  h.debug.select(ingredient);
  assertLength(
    offeredRecipes(h.debug.panelButtons()),
    0,
    `a ${REBUILT.name} does not stand in for the ` +
      `${REBUILT.recipe[0]!.type} it was built from`,
  );
});
