// overlays/recipe-book-ingredient-states — selected, owned, and missing read apart.
//
// `specs/hud.md` fixes three states for every ingredient of every recipe, "told
// apart at a glance": SELECTED when "the current selection is a base structure at
// that ingredient's type and quality", OWNED when "the yard holds a base
// structure at that ingredient's type and quality that is not the current
// selection", and MISSING otherwise.
//
// THE THREE POSES. One Capacitor at Scrap, which `specs/combinations.md` makes an
// ingredient of the Static Web: standing and selected, standing and not selected,
// and gone. Nothing else is ever on the yard, so the only ingredient whose state
// can move is that one.
//
// WHAT IS DECIDED, AND FROM WHERE. The state itself off `recipeEntries`, which
// reports the state the build drew that cell in — a build that marked the wrong
// ingredient, or that marked nothing, fails here whatever it painted. And, for
// the "at a glance" half, the pixels INSIDE the rectangle the build reported for
// that one cell, held pairwise apart: a build that drew SELECTED and OWNED the
// same way tells two of the three apart and satisfies neither the rule nor the
// player.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  recipeCell,
  standComponent,
  type Harness,
} from "../harness";
import {
  comboDef,
  type ComboId,
  type ComponentType,
  type Tier,
} from "../constants";
import { cellPixels, movedPoints } from "./book";

/** An ingredient of the Static Web (specs/combinations.md). */
const COMBO: ComboId = "staticweb";
const TYPE: ComponentType = "capacitor";
const TIER: Tier = 1;
const ANCHOR = { col: 10, row: 10 };

/**
 * Its index within that recipe, in the order `specs/combinations.md` lists the
 * Static Web's three ingredients — read off the recipe rather than written here,
 * so the cell this point names is the one the specification names.
 */
const INGREDIENT = comboDef(COMBO).recipe.findIndex(
  (part) => part.type === TYPE && part.tier === TIER,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a selected, an owned, and a missing ingredient three ways", async () => {
  await openYard(h);
  await h.debug.setOverlay("combos", true);

  const standing = await standComponent(h, TYPE, TIER, ANCHOR.col, ANCHOR.row);

  // OWNED: it stands and it is not the selection.
  await h.debug.clearSelection();
  const ownedCell = await recipeCell(h, COMBO, INGREDIENT);
  assertEqual(
    ownedCell.type,
    TYPE,
    `the type of the ${COMBO}'s ingredient ${INGREDIENT} ` +
      "(specs/combinations.md)",
  );
  assertEqual(
    ownedCell.quality,
    TIER,
    `the quality of the ${COMBO}'s ingredient ${INGREDIENT} ` +
      "(specs/combinations.md)",
  );
  assertEqual(
    ownedCell.state,
    "owned",
    `the state of the ${TYPE} cell with one standing on the yard and nothing ` +
      "selected (specs/hud.md)",
  );
  const owned = await cellPixels(h, ownedCell);

  // SELECTED: the same structure, now the selection.
  await h.debug.select(standing);
  const selectedCell = await recipeCell(h, COMBO, INGREDIENT);
  assertEqual(
    selectedCell.state,
    "selected",
    `the state of the ${TYPE} cell with that structure selected ` +
      "(specs/hud.md)",
  );
  const selected = await cellPixels(h, selectedCell);
  await captureStill(h, "states");

  // MISSING: nothing of that type and quality anywhere.
  await h.debug.clearStructures();
  const missingCell = await recipeCell(h, COMBO, INGREDIENT);
  assertEqual(
    missingCell.state,
    "missing",
    `the state of the ${TYPE} cell with an empty yard (specs/hud.md)`,
  );
  const missing = await cellPixels(h, missingCell);

  assertGreaterThan(
    movedPoints(owned, selected),
    0,
    "how many points inside the reported cell read differently with the " +
      "ingredient selected than with it merely owned",
  );
  assertGreaterThan(
    movedPoints(owned, missing),
    0,
    "how many points inside the reported cell read differently with the " +
      "ingredient missing than with it owned",
  );
  assertGreaterThan(
    movedPoints(selected, missing),
    0,
    "how many points inside the reported cell read differently with the " +
      "ingredient missing than with it selected",
  );
});
