// load/health-scales-by-wave — health follows the scaling formula.
//
// specs/enemies.md fixes a unit's maximum health on wave `w` as
//
//     HP(w) = round( baseHP * baseMult * [ (1 + k * (w - 1)) + c * (r^(w - 1) - 1) ] )
//
// with `baseMult`, `k`, `c` and `r` the chosen difficulty's four constants from
// specs/difficulty.md. The bracket carries a linear ramp and an exponential
// surcharge, and the two are what this check separates: a build that implemented
// the ramp and dropped the surcharge tracks the formula for the opening waves
// and falls further behind every wave after, so the sample runs from wave `1`
// out to the run's last wave rather than stopping where the two curves still
// agree.
//
// `setWave` sets the counter "so units released from now on scale to wave `n`"
// (specs/instrumentation.md), so each wave is reached without playing the waves
// before it, and the unit released at it is read on the frame it arrives. Three
// roster types are read at every wave, one light and two heavy, because the
// product is rounded once at the end and a build that rounds a factor earlier
// drifts by different amounts across different base figures.
//
// The rounding itself is the sibling `health-is-a-whole-number` check, and the
// opening of the formula at wave `1` is `wave-one-health`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { difficultyById, loadDef, scaledHp, type LoadType } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  releaseUnit,
  unitById,
  type Harness,
} from "../harness";

const DIFFICULTY = "medium";
const DEF = difficultyById(DIFFICULTY);

/** Waves across the whole run, thickest where the surcharge takes over. */
const SAMPLE = [1, 2, 3, 5, 10, 20, 30, 40, 45, DEF.waves];

/** One light type, one middling and one heavy: three base figures to round. */
const TYPES: LoadType[] = ["cluster", "mote", "slug"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scales maximum health by the difficulty's four constants at every wave", async () => {
  await openYard(h, { difficulty: DIFFICULTY });

  for (const wave of SAMPLE) {
    await h.debug.setWave(wave);
    for (const type of TYPES) {
      const id = await releaseUnit(h, type, { frozen: true });
      assertEqual(
        unitById(await h.snapshot(), id).maxHp,
        scaledHp(loadDef(type).baseHp, wave, DEF),
        `a ${type} on wave ${wave}: round(${loadDef(type).baseHp} * ` +
          `${DEF.baseMult} * [(1 + ${DEF.k} * ${wave - 1}) + ${DEF.c} * ` +
          `(${DEF.r}^${wave - 1} - 1)])`,
      );
      await h.debug.clearUnits();
    }
  }

  await h.debug.setWave(DEF.waves);
  for (const type of TYPES) await releaseUnit(h, type, { frozen: true });
  await h.advance(1);
  await captureStill(h, "scaling");
});
