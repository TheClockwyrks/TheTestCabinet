// combos/recipe-incomplete-refused — an incomplete recipe offers no fold.
//
// specs/combinations.md: "a recipe is satisfied only when the yard holds every
// ingredient it lists, counted as a multiset." specs/scrap-press.md fixes the
// inspector as offering one action per REACHABLE recipe, so a yard one
// ingredient short offers none, and a combine committed on a piece that would
// have been an ingredient folds nothing.
//
// The Static Web's recipe is `coil@1` + `capacitor@1` + `choke@1`; the yard is
// posed with the first two alone. The two are of different types, so no
// quality-fold is available either and a combine has nothing at all to resolve.
// What is read is that no recipe row is offered and that committing the combine
// leaves both components standing exactly as they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { comboDef } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { anchored, offeredRecipes } from "./towers";

const TOWER = comboDef("staticweb");
const INITIATOR = { col: 10, row: 10 };
const PARTNER = { col: 14, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers no recipe, and folds nothing, while an ingredient is missing", async () => {
  await openYard(h);
  const first = await standComponent(
    h,
    TOWER.recipe[0]!.type,
    TOWER.recipe[0]!.tier,
    INITIATOR.col,
    INITIATOR.row,
  );
  const second = await standComponent(
    h,
    TOWER.recipe[1]!.type,
    TOWER.recipe[1]!.tier,
    PARTNER.col,
    PARTNER.row,
  );

  await h.debug.select(first);
  await h.advance(1);
  await captureStill(h, "refused");
  assertLength(
    offeredRecipes(await h.debug.panelButtons()),
    0,
    `the ${TOWER.name} is one ingredient short, so no recipe is reachable`,
  );

  // Committed anyway, from a piece that would have been an ingredient.
  await h.debug.select(first);
  await h.debug.addToCombineSet(second);
  await h.debug.combine(first);

  const s = await h.snapshot();
  assertLength(s.structures, 2, "nothing was folded and nothing was consumed");
  assertEqual(
    anchored(s, INITIATOR.col, INITIATOR.row).kind,
    "component",
    "the initiating piece still stands as the component it was",
  );
  assertEqual(
    anchored(s, INITIATOR.col, INITIATOR.row).type,
    TOWER.recipe[0]!.type,
    "the initiating piece is unchanged",
  );
  assertEqual(
    anchored(s, PARTNER.col, PARTNER.row).kind,
    "component",
    "the second piece still stands as the component it was",
  );
});
