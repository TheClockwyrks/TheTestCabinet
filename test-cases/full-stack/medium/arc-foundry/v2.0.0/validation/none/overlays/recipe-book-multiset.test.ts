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
// provide: a yard holding a single Arc-Node covers ONE of the Singularity's two
// Arc-Node ingredients and leaves the other MISSING, and only a second Arc-Node
// at the other tier covers it too.
//
// A build that counted ownership by type, or that let one structure satisfy every
// ingredient naming it, marks both cells owned on the first Arc-Node. Both tiers
// appear in that one recipe and nowhere else in the twelve, so each step moves
// exactly one ingredient of one recipe.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

/** The Singularity's two Arc-Nodes (specs/combinations.md). */
const COMBO: ComboId = "singularity";
const TYPE: ComponentType = "arcnode";
const FIRST: Tier = 2;
const SECOND: Tier = 5;

/** Each one's index within that recipe, read off the recipe itself. */
const recipe = comboDef(COMBO).recipe;
const FIRST_CELL = recipe.findIndex(
  (part) => part.type === TYPE && part.tier === FIRST,
);
const SECOND_CELL = recipe.findIndex(
  (part) => part.type === TYPE && part.tier === SECOND,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("covers the second Arc-Node only once a second one stands", async () => {
  await openYard(h);
  await h.debug.setOverlay("combos", true);

  // Neither: both cells missing.
  assertEqual(
    (await recipeCell(h, COMBO, FIRST_CELL)).state,
    "missing",
    `the state of the ${COMBO}'s ${TYPE} at quality ${FIRST} on an empty yard`,
  );
  assertEqual(
    (await recipeCell(h, COMBO, SECOND_CELL)).state,
    "missing",
    `the state of the ${COMBO}'s ${TYPE} at quality ${SECOND} on an empty yard`,
  );

  // One Arc-Node at the first tier: it covers ITS ingredient and no other.
  await standComponent(h, TYPE, FIRST, 10, 10);
  await captureStill(h, "multiset");
  assertEqual(
    (await recipeCell(h, COMBO, FIRST_CELL)).state,
    "owned",
    `the state of the ${COMBO}'s ${TYPE} at quality ${FIRST} with one ` +
      "standing on the yard (specs/hud.md)",
  );
  assertEqual(
    (await recipeCell(h, COMBO, SECOND_CELL)).state,
    "missing",
    `the state of the ${COMBO}'s ${TYPE} at quality ${SECOND} with only the ` +
      `quality ${FIRST} one standing, which covers one ingredient and not ` +
      "both (specs/hud.md)",
  );

  // The second, at the other tier: now both are covered.
  await standComponent(h, TYPE, SECOND, 14, 10);
  assertEqual(
    (await recipeCell(h, COMBO, SECOND_CELL)).state,
    "owned",
    `the state of the ${COMBO}'s ${TYPE} at quality ${SECOND} once a second ` +
      "Arc-Node stands at that quality (specs/hud.md)",
  );
});
