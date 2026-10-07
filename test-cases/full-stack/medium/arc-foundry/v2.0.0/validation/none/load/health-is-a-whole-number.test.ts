// load/health-is-a-whole-number — the scaled figure is rounded, once, to an integer.
//
// specs/enemies.md: "A unit's maximum health is a whole number. The bracketed
// product is a real number and it is rounded to the nearest integer, with an
// exact half rounding up." The worked example in the same file pins two of them:
// on Medium a wave-`1` Mote's `9.68` is `10` and a Filament's `16.28` is `16`,
// so the rule is `round`, not a truncation and not a ceiling.
//
// Two things are read at every sample, and they fail differently. `maxHp` is an
// integer at all, which a build carrying the raw real forward breaks; and it is
// the CORRECTLY rounded integer, which a build that truncates breaks — `9.68`
// truncating to `9` and `16.28` to `16`, so a truncating build passes on some
// types and fails on others, and the sample is wide enough to reach the ones it
// fails on.
//
// The sample crosses all three difficulties, because `baseMult` differs between
// them and so does which side of a half each product lands on, and it reaches
// deep waves, where the surcharge makes the product large and its fraction
// arbitrary.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  DIFFICULTIES,
  LOAD_ROSTER,
  type LoadType,
  scaledHp,
} from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  releaseUnit,
  unitById,
  type Harness,
} from "../harness";

/** Waves sampled at every difficulty, all inside the shortest run's `40`. */
const SAMPLE = [1, 2, 4, 7, 13, 21, 34, 40];

/** Four of the six types: four different base figures to round. */
const TYPES: LoadType[] = ["mote", "spark", "cluster", "filament"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a correctly rounded whole number at every wave and difficulty", async () => {
  for (const difficulty of DIFFICULTIES) {
    await openYard(h, { difficulty: difficulty.id });
    for (const wave of SAMPLE) {
      await h.debug.setWave(wave);
      for (const type of TYPES) {
        const id = await releaseUnit(h, type, { frozen: true });
        const maxHp = unitById(await h.snapshot(), id).maxHp;
        assertEqual(
          Number.isInteger(maxHp),
          true,
          `a whole number of health for a ${type} on wave ${wave} at ` +
            `${difficulty.id}`,
        );
        assertEqual(
          maxHp,
          scaledHp(
            LOAD_ROSTER.find((unit) => unit.type === type)!.baseHp,
            wave,
            difficulty,
          ),
          `a ${type} on wave ${wave} at ${difficulty.id}, rounded to the ` +
            `nearest with an exact half rounding up`,
        );
        await h.debug.clearUnits();
      }
    }
  }

  await h.debug.setWave(1);
  for (const type of TYPES) await releaseUnit(h, type, { frozen: true });
  await h.advance(1);
  await captureStill(h, "rounding");
});
