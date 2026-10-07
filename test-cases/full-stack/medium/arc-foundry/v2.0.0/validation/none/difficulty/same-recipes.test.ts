// difficulty/same-recipes — the inspector offers the same recipes at
// every difficulty.
//
// THE REQUIREMENT. `specs/difficulty.md` is explicit about the negative: "A
// difficulty sets the number of waves and the constants of the per-wave health
// scaling, and nothing else. Every other value is identical at every difficulty:
// the starting Charge, the starting Grid Integrity, the stamp allowance, the
// refinement track and its costs, the Load roster's base figures, the bounties,
// the leak values, the wave-clear bonus, the component stats, and the recipes."
// That sentence names several separately observable things, and a build can get
// any one of them wrong on its own, so each is its own point.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, not against the specification's
// numbers: what the starting Charge is, what a Slug's bounty is and what a
// Charged Capacitor hits for are each decided by a point of their own on the
// economy, campaign and component checklists, and a build that gets one of them
// wrong should fail that point once rather than twice over. What is decided HERE
// is that whichever figure a build carries, it carries the same one at Easy, at
// Medium and at Hard.
//
// HOW IT IS DECIDED. At each difficulty every one of the twelve recipes is stood
// up in full on the yard, one of its own ingredients is selected, and the
// `combine-special` rows the inspector offers are read off `panelButtons`. The
// three difficulties' readings are held against each other.

import { afterEach, beforeEach, it } from "vitest";
import { type ComboDef, COMBOS } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { sameAtEveryDifficulty, BENCH } from "./same";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers the same recipes at every difficulty", async () => {
  await sameAtEveryDifficulty(
    "the recipes the inspector offers",
    async (difficulty) => {
      await openYard(h, { difficulty });

      const offered: Record<string, string[]> = {};
      for (const combo of COMBOS as readonly ComboDef[]) {
        await h.debug.clearStructures();
        const ids: number[] = [];
        for (const [index, ingredient] of combo.recipe.entries()) {
          const anchor = BENCH[index]!;
          ids.push(
            await standComponent(
              h,
              ingredient.type,
              ingredient.tier,
              anchor.col,
              anchor.row,
            ),
          );
        }
        // The recipe is reachable from any of its own ingredients, so the piece
        // the combine would be initiated from is one of the pieces just stood up.
        await h.debug.select(ids[0]!);
        const rows = await h.debug.panelButtons();
        offered[combo.id] = rows
          .filter((row) => row.action === "combine-special")
          .map((row) => row.label.trim().toUpperCase())
          .sort();
      }

      await captureStill(h, "recipes");
      return offered;
    },
  );
});
