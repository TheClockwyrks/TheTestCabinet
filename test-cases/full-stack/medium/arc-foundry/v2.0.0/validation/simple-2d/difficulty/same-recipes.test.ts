// difficulty/same-recipes — the inspector offers the same recipes at every
// difficulty.
//
// `specs/difficulty.md` names them among the values "identical at every
// difficulty": "the recipes". So each of the twelve recipes of
// `specs/combinations.md` is stood up on the yard in turn, one of its own
// ingredients is selected, and the `combine-special` rows the inspector offers are
// read back — at each of the three difficulties, held against each other.
//
// What each recipe IS is decided by the combinations checklist, so a build with a
// wrong ingredient list fails there rather than twice over here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  type Combo as ComboDef,
  COMBOS,
  QUALITY_TIERS,
  type RecipeIngredient,
  type Tier,
} from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  standComponent,
} from "../harness";
import { sameAtEveryDifficulty } from "./same";

/**
 * One recipe ingredient's quality tier.
 *
 * `COMBOS` types an ingredient's `tier` as a plain number and the ladder is the
 * five rungs `1`–`5` (`specs/components.md`), so the figure is checked against the
 * ladder once here rather than at each anchor it is stood on.
 */
function tierOf(ingredient: RecipeIngredient): Tier {
  const { tier } = ingredient;
  assertEqual(
    tier >= 1 && tier <= QUALITY_TIERS.length,
    true,
    `the ${ingredient.type} of a recipe to sit on the five-rung quality ` +
      `ladder; it is listed at tier ${tier}`,
  );
  return tier as Tier;
}

/** The anchors a recipe's ingredients are stood on: clear of every map's chain. */
const BENCH = [
  { col: 10, row: 0 },
  { col: 13, row: 0 },
  { col: 16, row: 0 },
  { col: 19, row: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("offers the same recipes at every difficulty", async () => {
  await sameAtEveryDifficulty(
    "the recipes the inspector offers",
    async (difficulty) => {
      openYard(h, { difficulty });

      const offered: Record<string, string[]> = {};
      for (const combo of COMBOS as readonly ComboDef[]) {
        h.debug.clearStructures();
        const ids: number[] = [];
        for (const [index, ingredient] of combo.recipe.entries()) {
          const anchor = BENCH[index]!;
          ids.push(
            standComponent(
              h,
              ingredient.type,
              tierOf(ingredient),
              anchor.col,
              anchor.row,
            ),
          );
        }
        // The recipe is reachable from any of its own ingredients, so the piece
        // the combine would be initiated from is one of the pieces just stood up.
        h.debug.select(ids[0]!);
        const rows = h.debug.panelButtons();
        offered[combo.id] = rows
          .filter((row) => row.action === "combine-special")
          .map((row) => row.label.trim().toUpperCase())
          .sort();
      }

      return offered;
    },
  );
  // The last of the three readings, drawn: the yard the comparison ended on.
  await h.advance(1);
  captureStill(h, "recipes");
});
