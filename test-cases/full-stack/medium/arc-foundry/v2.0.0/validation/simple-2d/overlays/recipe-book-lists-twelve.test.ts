// overlays/recipe-book-lists-twelve — all twelve towers, with their stats.
//
// `specs/hud.md`: "the recipe book is a read-only overlay listing all twelve
// combination towers, each with its exact recipe and its headline stats".
// `specs/combinations.md` holds the twelve in `COMBOS`, each with its name, its
// recipe, and the reference block a level-`3` tower scales toward.
//
// WHAT IS DECIDED, AND WHAT IS NOT. Every tower's name has to be on the overlay,
// with its range, its fire rate, and its damage, and every type its recipe calls
// for has to be named there too. The damage is accepted at either of the two
// figures the specification makes headline: the reference block, and the figure a
// tower actually lands at, which is `COMBO_DAMAGE_MULT[0]` of it — `specs/hud.md`
// says "headline stats" without choosing between them, and a build that shows a
// player what a tower lands as has not misread it.
//
// A recipe's TIERS are not decided here. `specs/combinations.md` writes an
// ingredient `type@tier` but fixes no notation a build must draw, and a book
// setting Scrap as `I`, as `1`, or as the word is drawing the same recipe. What a
// flat read of the overlay's text can decide is that the type is named; binding a
// tier to it would grade the notation. A type is named by the name
// `specs/components.md` gives it, as `../constants` spells it: `Arc-Node`, with
// its hyphen, and `Discharge Rig`, with its space, are the copy, not the
// identifiers `arcnode` and `discharge`.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drew,
  figures,
  type Harness,
  openYard,
  recipeCells,
  type Region,
} from "../harness";
import {
  COMBO_DAMAGE_MULT,
  COMBOS,
  COMPONENT_NAMES,
  STAGE_H,
  STAGE_W,
} from "../constants";

/** The overlay covers the stage, so the whole of it is read. */
const OVERLAY: Region = { x0: 0, y0: 0, x1: STAGE_W, y1: STAGE_H };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lists every one of the twelve towers with its stats", async () => {
  openYard(h);
  h.debug.setOverlay("combos", true);

  const drawn = await h.frameCalls();
  captureStill(h, "book");
  const numbers = figures(drawn, OVERLAY);
  assertGreaterThan(
    numbers.length,
    0,
    "how many figures the recipe book drew at all",
  );

  for (const combo of COMBOS) {
    assertEqual(
      drew(drawn, OVERLAY, combo.name),
      true,
      `whether the recipe book names the ${combo.name}`,
    );
    assertContains(
      numbers,
      combo.range,
      `the recipe book's figures, for the ${combo.name}'s range`,
    );
    assertContains(
      numbers,
      combo.fireRate,
      `the recipe book's figures, for the ${combo.name}'s fire rate`,
    );
    const landed = combo.damage * COMBO_DAMAGE_MULT[0]!;
    assertEqual(
      numbers.some((f) => f === combo.damage || Math.abs(f - landed) <= 0.5),
      true,
      `whether the recipe book draws the ${combo.name}'s damage, as either ` +
        `its reference ${combo.damage} or the ${landed} it lands at`,
    );
    for (const ingredient of combo.recipe) {
      assertEqual(
        drew(drawn, OVERLAY, COMPONENT_NAMES[ingredient.type]),
        true,
        `whether the recipe book names the ${COMPONENT_NAMES[ingredient.type]} ` +
          `the ${combo.name}'s recipe calls for`,
      );
    }

    // And the book draws the recipe EXACTLY: one cell per ingredient, in the
    // order `specs/combinations.md` lists them, each at the type and quality that
    // recipe calls for. `specs/hud.md` requires "every ingredient of every
    // recipe" to be drawn, and `specs/instrumentation.md` has the build report
    // each cell it drew, so a book that drew eleven of the twelve recipes, or one
    // recipe short of an ingredient, fails here rather than passing on the names
    // its neighbours happened to draw.
    assertEqual(
      recipeCells(h, combo.id)
        .map((cell) => `${cell.type}@${cell.quality}`)
        .join(" + "),
      combo.recipe
        .map((ingredient) => `${ingredient.type}@${ingredient.tier}`)
        .join(" + "),
      `the ingredient cells the recipe book draws for the ${combo.name} ` +
        "(specs/combinations.md, specs/hud.md)",
    );
  }
});
