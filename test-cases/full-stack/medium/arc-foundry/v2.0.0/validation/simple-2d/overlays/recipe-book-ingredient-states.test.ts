// overlays/recipe-book-ingredient-states — selected, owned, and missing read apart.
//
// `specs/hud.md` fixes three states for every ingredient of every recipe, "told
// apart at a glance": SELECTED when "the current selection is a base structure at
// that ingredient's type and quality", OWNED when "the yard holds a base
// structure at that ingredient's type and quality that is not the current
// selection", and MISSING otherwise.
//
// THE THREE POSES. One Capacitor at Scrap, which `specs/combinations.md` makes the
// second ingredient of the Static Web and of no other recipe among the twelve:
// standing and selected, standing and not selected, and gone. Nothing else is ever
// on the yard, so exactly one cell of the book can move and every other cell is
// missing throughout — which is asserted, because a build that lit the whole book
// on any structure at all would satisfy a check that only looked at the one cell.
//
// TWO HALVES, EACH READ WHERE IT IS ANSWERED. The STATE comes off `recipeEntries`,
// which `specs/instrumentation.md` has the build report per ingredient cell, so what
// is decided is that this ingredient reads Selected, Owned and Missing in the three
// poses `specs/hud.md` defines. "TOLD APART AT A GLANCE" is a claim about the
// picture, so it is read from the pixels of that one reported cell, held pairwise
// apart — a build that drew Selected and Owned the same way would tell two of the
// three apart and satisfy neither the rule nor the player.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  recipeCells,
  recipeEntries,
  standComponent,
  type Harness,
} from "../harness";
import { movedPoints, readCell } from "./book";
import type { ComboId, ComponentType, Tier } from "../constants";

/** The Static Web's Capacitor at Scrap (specs/combinations.md). */
const COMBO: ComboId = "staticweb";
const TYPE: ComponentType = "capacitor";
const TIER: Tier = 1;
const ANCHOR = { col: 10, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Where in the Static Web's recipe the Capacitor at Scrap sits. */
function ingredientIndex(): number {
  const cells = recipeCells(h, COMBO);
  const at = cells.findIndex((c) => c.type === TYPE && c.quality === TIER);
  assertGreaterThan(
    at,
    -1,
    `the ${COMBO}'s recipe to call for a ${TYPE} at tier ${TIER}, as ` +
      `specs/combinations.md lists it; it calls for ` +
      cells.map((c) => `${c.type}@${c.quality}`).join(", "),
  );
  return at;
}

/** Every cell but the one under test, which nothing on this yard can own. */
function others(index: number): string[] {
  return recipeEntries(h)
    .filter((e) => !(e.combo === COMBO && e.ingredient === index))
    .filter((e) => e.state !== "missing")
    .map((e) => `${e.combo}[${e.ingredient}] ${e.type}@${e.quality}`);
}

it("draws a selected, an owned, and a missing ingredient three ways", async () => {
  openYard(h);
  h.debug.setOverlay("combos", true);

  const index = ingredientIndex();
  const cell = recipeCells(h, COMBO)[index]!;

  // OWNED: it stands on the yard and is not the selection.
  const standing = standComponent(h, TYPE, TIER, ANCHOR.col, ANCHOR.row);
  h.debug.clearSelection();
  assertEqual(
    recipeCells(h, COMBO)[index]!.state,
    "owned",
    `the ${COMBO}'s ${TYPE} at tier ${TIER} with one standing on the yard and ` +
      "nothing selected (specs/hud.md)",
  );
  assertEqual(
    others(index).join(", "),
    "",
    "which other ingredient cells the book marks while the yard holds one " +
      `${TYPE} at tier ${TIER}, which no other recipe calls for ` +
      "(specs/combinations.md)",
  );
  const owned = await readCell(h, cell);

  // SELECTED: the same structure, now the selection.
  h.debug.select(standing);
  assertEqual(
    recipeCells(h, COMBO)[index]!.state,
    "selected",
    `the ${COMBO}'s ${TYPE} at tier ${TIER} with that structure selected ` +
      "(specs/hud.md)",
  );
  const selected = await readCell(h, cell);
  captureStill(h, "states");

  // MISSING: nothing of that type and quality on the yard at all.
  h.debug.clearStructures();
  assertEqual(
    recipeCells(h, COMBO)[index]!.state,
    "missing",
    `the ${COMBO}'s ${TYPE} at tier ${TIER} with the yard empty (specs/hud.md)`,
  );
  const missing = await readCell(h, cell);

  // And the three are told apart at a glance, inside the cell the build reported.
  assertGreaterThan(
    movedPoints(owned, selected),
    0,
    `how many points of the reported ${TYPE}@${TIER} cell read differently ` +
      "with the ingredient selected than with it merely owned (specs/hud.md)",
  );
  assertGreaterThan(
    movedPoints(owned, missing),
    0,
    `how many points of the reported ${TYPE}@${TIER} cell read differently ` +
      "with the ingredient missing than with it owned (specs/hud.md)",
  );
  assertGreaterThan(
    movedPoints(selected, missing),
    0,
    `how many points of the reported ${TYPE}@${TIER} cell read differently ` +
      "with the ingredient missing than with it selected (specs/hud.md)",
  );
});
