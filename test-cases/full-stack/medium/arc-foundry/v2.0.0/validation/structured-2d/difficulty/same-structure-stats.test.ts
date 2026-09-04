// difficulty/same-structure-stats — every difficulty gives a structure the same block.
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
// names which one drifted. This one is about the damage, range, fire rate, aura and abilities of every component at every tier.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, not against the specification's
// numbers: whether the starting Charge is `10`, what a Slug's bounty is, and what
// a Charged Capacitor hits for are each decided by a point of their own on the
// economy, campaign and component checklists, and a build that gets one of them
// wrong should fail that point once rather than twice over. What is decided HERE
// is that whichever figure a build carries, it carries the same one at Easy, at
// Medium and at Hard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { COMPONENT_TYPES, type DifficultyId } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

/** The anchor a bench structure is stood on: clear of every map's chain. */
const BENCH = { col: 10, row: 0 };

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

it("gives every component the same stats at every difficulty", async () => {
  await sameAtEveryDifficulty("the structures' stats", async (difficulty) => {
    openYard(h, { difficulty });

    const components: Record<string, unknown> = {};
    for (const type of COMPONENT_TYPES) {
      for (const tier of [1, 3, 5] as const) {
        h.debug.clearStructures();
        const id = standComponent(h, type, tier, BENCH.col, BENCH.row);
        const stood = structureById(h.snapshot(), id);
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

    return components;
  });
  await h.advance(1);
  captureStill(h, "stats");
});
