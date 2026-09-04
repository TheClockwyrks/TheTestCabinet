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
// provide: a yard holding a single Arc-Node at one of those two tiers covers THAT
// ingredient and not the other, and the other is covered only once a second
// Arc-Node stands at its own tier.
//
// The two cells are read by name, because `specs/instrumentation.md` has the build
// report each ingredient cell with the type and quality it stands for. A build that
// counted ownership by type, or that let one structure satisfy every ingredient
// naming it, marks both cells on the first Arc-Node and fails here on the cell it
// marked early rather than on a pixel somewhere in the overlay.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  recipeCells,
  standComponent,
  type Harness,
} from "../harness";
import type { ComboId, ComponentType, Tier } from "../constants";

/** The Singularity's two Arc-Nodes (specs/combinations.md). */
const COMBO: ComboId = "singularity";
const TYPE: ComponentType = "arcnode";
const FIRST: Tier = 2;
const SECOND: Tier = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The state the book draws the Singularity's Arc-Node at `tier` in. */
function stateAt(tier: Tier): string {
  const cells = recipeCells(h, COMBO).filter(
    (c) => c.type === TYPE && c.quality === tier,
  );
  assertEqual(
    cells.length,
    1,
    `how many cells the ${COMBO}'s recipe gives a ${TYPE} at tier ${tier} ` +
      "(specs/combinations.md)",
  );
  return cells[0]!.state;
}

it("covers the second Arc-Node only once a second one stands", async () => {
  openYard(h);
  h.debug.setOverlay("combos", true);

  const recipe = recipeCells(h, COMBO);
  assertGreaterThan(
    recipe.length,
    0,
    `how many ingredient cells the book reports for the ${COMBO} ` +
      "(specs/instrumentation.md)",
  );

  // Neither Arc-Node stands.
  assertEqual(stateAt(FIRST), "missing", `the ${TYPE} at tier ${FIRST}`);
  assertEqual(stateAt(SECOND), "missing", `the ${TYPE} at tier ${SECOND}`);

  // One does, at the first tier: it covers that ingredient and not the other.
  standComponent(h, TYPE, FIRST, 10, 10);
  assertEqual(
    stateAt(FIRST),
    "owned",
    `the ${TYPE} at tier ${FIRST} with one standing on the yard ` +
      "(specs/hud.md)",
  );
  assertEqual(
    stateAt(SECOND),
    "missing",
    `the ${TYPE} at tier ${SECOND} with only a tier-${FIRST} one standing; ` +
      "ownership counts as a multiset, so one structure covers one ingredient " +
      "(specs/hud.md)",
  );

  // And the second one covers the second ingredient.
  standComponent(h, TYPE, SECOND, 14, 10);
  captureStill(h, "multiset");
  assertEqual(
    stateAt(FIRST),
    "owned",
    `the ${TYPE} at tier ${FIRST} with both standing`,
  );
  assertEqual(
    stateAt(SECOND),
    "owned",
    `the ${TYPE} at tier ${SECOND} with one of each standing (specs/hud.md)`,
  );
});
