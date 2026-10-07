// overlays/recipe-book-blockers-not-owned — a wall and a tower own nothing.
//
// `specs/hud.md`: "blockers and combination towers are never ingredients and
// never count as owned." `specs/scrap-press.md` gives a blocker "no type, no
// quality", and `specs/combinations.md` states that "a combination tower is never
// an ingredient".
//
// So a yard holding a blocker and a Static Web — a tower whose own recipe is three
// base components — must leave EVERY ingredient of ALL TWELVE recipes reading
// `missing`, exactly as an empty yard does. The control is the third pose: a
// Capacitor at Scrap, one of the Static Web's ingredients, which must turn its own
// cell `owned`. Without it a book that marked nothing owned ever would pass this
// point by reporting nothing.
//
// EVERY CELL IS READ, NOT A REGION OF THE STAGE. `recipeEntries` reports each
// ingredient cell with the recipe it belongs to and its state
// (`specs/instrumentation.md`), so this decides the requirement over all twelve
// recipes at once and names the cell that broke it. The blocker's and the tower's
// sprites on the yard are not read at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
  standCombo,
  standComponent,
  type Harness,
} from "../harness";
import type { RecipeEntry } from "../harness";
import { cell, openBook } from "./book";
import {
  type ComboId,
  COMBOS,
  type ComponentType,
  type Tier,
} from "../constants";

/** An ingredient of the Static Web (specs/combinations.md). */
const COMBO: ComboId = "staticweb";
const INGREDIENT = 1;
const TYPE: ComponentType = "capacitor";
const TIER: Tier = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Every cell the book drew, with the book open on a settled frame. */
async function cells(h2: Harness): Promise<RecipeEntry[]> {
  openBook(h2);
  await h2.advance(1);
  return h2.debug.recipeEntries();
}

/** How many cells the twelve recipes hold between them. */
const EXPECTED_CELLS = COMBOS.reduce(
  (total, combo) => total + combo.recipe.length,
  0,
);

it("counts neither a blocker nor a tower as an ingredient", async () => {
  openYard(h);
  h.debug.clearStructures();

  const bare = await cells(h);
  assertEqual(
    bare.length,
    EXPECTED_CELLS,
    "how many ingredient cells the book draws for the twelve recipes " +
      "(specs/combinations.md)",
  );
  assertEqual(
    bare.every((entry) => entry.state === "missing"),
    true,
    "whether every ingredient of every recipe reads missing on an empty yard",
  );

  h.debug.setOverlay("combos", false);
  h.debug.clearStructures();
  standBlocker(h, 10, 10);
  standCombo(h, COMBO, 14, 10);
  const walled = await cells(h);
  captureStill(h, "book");
  const owned = walled.filter((entry) => entry.state !== "missing");
  assertEqual(
    owned.map((entry) => `${entry.combo}[${entry.ingredient}]`).join(", "),
    "",
    "which ingredient cells a yard holding one blocker and one Static Web " +
      "marks as anything but missing, neither of which is ever an ingredient",
  );

  // The control: a real ingredient does move its own cell, so a book that
  // reported `missing` for everything always is not what passed above.
  h.debug.setOverlay("combos", false);
  h.debug.clearStructures();
  standComponent(h, TYPE, TIER, 10, 10);
  h.debug.clearSelection();
  await cells(h);
  assertEqual(
    cell(h, COMBO, INGREDIENT).state,
    "owned",
    `the state the book gives the ${TYPE} at tier ${TIER} the ${COMBO} ` +
      "recipe calls for, with one standing on the yard",
  );
});
