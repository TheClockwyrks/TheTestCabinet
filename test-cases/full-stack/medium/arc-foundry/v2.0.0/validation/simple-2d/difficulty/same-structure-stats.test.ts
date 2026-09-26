// difficulty/same-structure-stats — every component carries the same damage,
// range, fire rate, aura and abilities at every difficulty.
//
// `specs/difficulty.md` names them among the values "identical at every
// difficulty": "the component stats". So each of the eight base types is stood up
// at the bottom, the middle and the top of the quality ladder at each of the three
// difficulties, and the block the inspector reads off it is held against the other
// two.
//
// What each stat IS is decided by the components checklist, so a build that reads
// a Charged Capacitor wrong fails there rather than twice over here.

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
import { sameAtEveryDifficulty } from "./same";

/** Where the inspected component stands: clear of every map's chain. */
const BENCH = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

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
  // The last of the three readings, drawn: the yard the comparison ended on.
  await h.advance(1);
  captureStill(h, "stats");
});
