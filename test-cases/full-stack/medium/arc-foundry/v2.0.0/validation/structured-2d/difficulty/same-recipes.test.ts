// difficulty/same-recipes — every difficulty offers the same twelve recipes.
//
// THE REQUIREMENT. `specs/difficulty.md` is explicit about the negative: "A
// difficulty sets the number of waves and the constants of the per-wave health
// scaling, and nothing else. Every other value is identical at every difficulty:
// the starting Charge, the starting Grid Integrity, the stamp allowance, the
// refinement track and its costs, the Load roster's base figures, the bounties,
// the leak values, the wave-clear bonus, the component stats, and the recipes."
//
// ONE GROUP PER CHECK. Those figures are reached five different ways — off a fresh
// run, off the refinement track, off standing structures, off the inspector, and
// off a unit actually dying or leaking — and a build can leak the difficulty into
// one of the five and not the others, so each is decided on its own and a grade
// names which one drifted. This one is about the recipes the inspector offers over each of the twelve towers' ingredients.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, not against the specification's
// numbers: whether the starting Charge is `10`, what a Slug's bounty is, and what
// a Charged Capacitor hits for are each decided by a point of their own on the
// economy, campaign and component checklists, and a build that gets one of them
// wrong should fail that point once rather than twice over. What is decided HERE
// is that whichever figure a build carries, it carries the same one at Easy, at
// Medium and at Hard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  type Combo as ComboDef,
  COMBOS,
  type DifficultyId,
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

/**
 * Read one figure at each difficulty in turn and hold the three against each
 * other.
 *
 * The Easy reading is the one the other two are compared to, so a failure names
 * the difficulty that drifted and what it drifted to.
 */
async function sameAtEveryDifficulty<T>(
  what: string,
  read: (difficulty: DifficultyId) => Promise<T>,
): Promise<T> {
  const easy = await read("easy");
  for (const difficulty of ["medium", "hard"] as const) {
    const other = await read(difficulty);
    assertDeepEqual(
      other,
      easy,
      `${what} to be the same at ${difficulty} as at easy, because difficulty ` +
        "sets the wave count and the health scaling alone (specs/difficulty.md)",
    );
  }
  return easy;
}

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
  await h.advance(1);
  captureStill(h, "recipes");
});
