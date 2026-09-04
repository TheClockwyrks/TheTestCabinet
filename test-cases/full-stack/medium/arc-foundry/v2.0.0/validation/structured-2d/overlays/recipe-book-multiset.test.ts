// overlays/recipe-book-multiset — one structure covers one ingredient, not two.
//
// `specs/hud.md`: "ownership counts as a multiset, so a recipe calling for two
// ingredients at the same type and quality reads as covered only when the yard
// holds two."
//
// A SPECIFICATION GAP, AND WHAT IS DECIDED INSTEAD. None of the twelve recipes in
// `specs/combinations.md` calls for two ingredients at the same type AND quality;
// the nearest is the Singularity, which "calls for two Arc-Nodes at different
// tiers", and `specs/combinations.md` states the counting rule there: "a recipe is
// satisfied only when the yard holds every ingredient it lists, counted as a
// multiset". So the requirement is instantiated at the one recipe the twelve
// provide: a yard holding a single Arc-Node covers the ONE of the Singularity's
// two Arc-Node ingredients whose tier it is, and leaves the other missing until a
// second Arc-Node stands at that tier. A build that counted ownership by type, or
// that let one structure satisfy every ingredient naming it, marks both on the
// first Arc-Node.
//
// The two cells are told apart by the ingredient index `recipeEntries` reports
// (`specs/instrumentation.md`), so the check names which of the two the build got
// wrong rather than saying that something on the overlay did or did not move.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { cell, openBook } from "./book";
import type { ComboId, ComponentType, Tier } from "../constants";

/** The Singularity's two Arc-Nodes (specs/combinations.md). */
const COMBO: ComboId = "singularity";
const TYPE: ComponentType = "arcnode";
/** Ingredient `0` is the Arc-Node at tier 5, ingredient `3` the one at tier 2. */
const HIGH = { ingredient: 0, tier: 5 as Tier };
const LOW = { ingredient: 3, tier: 2 as Tier };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The state the book reports for each of the two Arc-Node cells. */
async function states(): Promise<{ high: string; low: string }> {
  openBook(h);
  await h.advance(1);
  const high = cell(h, COMBO, HIGH.ingredient);
  const low = cell(h, COMBO, LOW.ingredient);
  assertEqual(
    `${high.type}@${high.quality} ${low.type}@${low.quality}`,
    `${TYPE}@${HIGH.tier} ${TYPE}@${LOW.tier}`,
    `the two ingredients recipeEntries reports at indexes ${HIGH.ingredient} ` +
      `and ${LOW.ingredient} of the ${COMBO} recipe (specs/combinations.md)`,
  );
  return { high: high.state, low: low.state };
}

it("covers the second Arc-Node only once a second one stands", async () => {
  openYard(h);
  h.debug.clearStructures();

  const neither = await states();
  assertEqual(
    `${neither.high}/${neither.low}`,
    "missing/missing",
    "the two Arc-Node ingredients' states with neither on the yard",
  );

  h.debug.setOverlay("combos", false);
  standComponent(h, TYPE, LOW.tier, 10, 10);
  h.debug.clearSelection();
  const one = await states();
  assertEqual(
    `${one.high}/${one.low}`,
    "missing/owned",
    `the two Arc-Node ingredients' states with one Arc-Node at tier ` +
      `${LOW.tier} standing, which covers that tier's ingredient and not the ` +
      `tier ${HIGH.tier} one`,
  );

  h.debug.setOverlay("combos", false);
  standComponent(h, TYPE, HIGH.tier, 14, 10);
  h.debug.clearSelection();
  const both = await states();
  captureStill(h, "multiset");
  assertEqual(
    `${both.high}/${both.low}`,
    "owned/owned",
    "the two Arc-Node ingredients' states with one of each tier standing",
  );
});
