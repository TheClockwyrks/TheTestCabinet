// overlays/recipe-book-blockers-not-owned — a wall and a tower own nothing.
//
// `specs/hud.md`: "blockers and combination towers are never ingredients and
// never count as owned." `specs/scrap-press.md` gives a blocker "no type, no
// quality", and `specs/combinations.md` states that "a combination tower is never
// an ingredient".
//
// So a yard holding a blocker and a Static Web — a tower whose own recipe is
// three base components — must leave every one of that recipe's ingredients
// reading MISSING, exactly as an empty yard does. The control is the third pose:
// a Capacitor at Scrap, one of the Static Web's ingredients, which must turn its
// cell OWNED. Without it, a book that marked nothing at all would pass this point
// by never marking anything.
//
// The state is read off `recipeEntries`, which reports the state the build drew
// each cell in, so what is decided is what the book says about each ingredient
// rather than whether any pixel of the overlay moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  recipeCell,
  recipeCells,
  standBlocker,
  standCombo,
  standComponent,
  type Harness,
} from "../harness";
import {
  comboDef,
  type ComboId,
  type ComponentType,
  type Tier,
} from "../constants";

/** An ingredient of the Static Web (specs/combinations.md). */
const COMBO: ComboId = "staticweb";
const TYPE: ComponentType = "capacitor";
const TIER: Tier = 1;

/** Its index within that recipe, read off the recipe the specification lists. */
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

it("counts neither a blocker nor a tower as an ingredient", async () => {
  await openYard(h);
  await h.debug.setOverlay("combos", true);

  // An empty yard: nothing is owned, which is the baseline the other two poses
  // are read against.
  for (const cell of await recipeCells(h, COMBO)) {
    assertEqual(
      cell.state,
      "missing",
      `the state of the ${COMBO}'s ${cell.type} at quality ${cell.quality} ` +
        "on an empty yard (specs/hud.md)",
    );
  }

  // A blocker and a combination tower: neither is ever an ingredient, so the
  // book must read exactly as it did on the empty yard.
  await standBlocker(h, 10, 10);
  await standCombo(h, COMBO, 14, 10);
  await captureStill(h, "book");
  for (const cell of await recipeCells(h, COMBO)) {
    assertEqual(
      cell.state,
      "missing",
      `the state of the ${COMBO}'s ${cell.type} at quality ${cell.quality} ` +
        "on a yard holding a blocker and a combination tower, neither of " +
        "which is ever an ingredient (specs/hud.md)",
    );
  }

  // The control: a base structure at an ingredient's type and quality IS owned,
  // so a book that marks nothing fails here.
  await h.debug.clearStructures();
  await standComponent(h, TYPE, TIER, 10, 10);
  assertEqual(
    (await recipeCell(h, COMBO, INGREDIENT)).state,
    "owned",
    `the state of the ${COMBO}'s ${TYPE} cell with one standing on the yard ` +
      "(specs/hud.md)",
  );
});
