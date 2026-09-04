// difficulty/same-structure-stats — every component carries the same
// stats at every difficulty.
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
// HOW IT IS DECIDED. At each difficulty every base component type is stood up at
// the bottom, middle and top of the quality ladder, and the damage, range, fire
// rate, aura and abilities the snapshot reports for it are read. The three
// difficulties' readings are held against each other.

import { afterEach, beforeEach, it } from "vitest";
import { COMPONENT_TYPES } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  structureById,
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

it("gives every component and every tower the same stats at every difficulty", async () => {
  await sameAtEveryDifficulty("the structures' stats", async (difficulty) => {
    await openYard(h, { difficulty });

    const components: Record<string, unknown> = {};
    for (const type of COMPONENT_TYPES) {
      for (const tier of [1, 3, 5] as const) {
        await h.debug.clearStructures();
        const id = await standComponent(
          h,
          type,
          tier,
          BENCH[0]!.col,
          BENCH[0]!.row,
        );
        const stood = structureById(await h.snapshot(), id);
        components[`${type}@${tier}`] = {
          damage: stood.damage,
          range: stood.range,
          fireRate: stood.fireRate,
          auraRadius: stood.auraRadius,
          auraBonus: stood.auraBonus,
          abilities: [...stood.abilities].sort(),
        };
      }
    }

    await captureStill(h, "stats");
    return components;
  });
});
