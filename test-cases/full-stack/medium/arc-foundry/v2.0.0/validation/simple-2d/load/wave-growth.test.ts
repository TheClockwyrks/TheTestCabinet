// load/wave-growth — a wave's health pool never falls.
//
// specs/enemies.md, under the rules a wave's composition obeys: "Growth — A
// wave's total health pool is at least that of the wave before it." A wave's
// pool is the sum of the maximum health of every unit it releases, and
// specs/instrumentation.md reports each unit's `maxHp` at the wave it was scaled
// to, so the pool is read rather than inferred.
//
// The rule is about CONSECUTIVE waves, so the sample is three consecutive runs
// of waves rather than a scatter: the run's opening eight, the three around its
// middle milestone, and its last three. Only neighbouring pairs are compared,
// which is what the rule states — a build whose wave `21` is easier than its
// wave `20` fails on that pair, and one whose pool grows unevenly but never
// falls passes.
//
// The milestone waves are inside two of those runs deliberately: a Dynamo is a
// large pool of its own, and the wave after a milestone is where a naive
// composer dips.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { captureReplay, type Harness } from "../harness";
import { collectWave, createWaveHarness, healthPool, openWave } from "./waves";
import { difficultyById, milestoneWaves } from "../constants";

const DIFFICULTY = "easy";
const [MIDDLE, LAST] = milestoneWaves(difficultyById(DIFFICULTY).waves);

/** Three runs of consecutive waves. Only neighbours within a run are compared. */
const RUNS = [
  [1, 2, 3, 4, 5, 6, 7, 8],
  [MIDDLE - 1, MIDDLE, MIDDLE + 1],
  [LAST - 2, LAST - 1, LAST],
];

/** The wave kept as the clip: the middle milestone, the run's heaviest step. */
const EVIDENCE = MIDDLE;

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(() => {
  h.dispose();
});

it("never releases a wave whose pool is smaller than the wave before it", async () => {
  for (const run of RUNS) {
    let previous: { wave: number; pool: number } | null = null;
    for (const wave of run) {
      openWave(h, wave, DIFFICULTY);
      const released =
        wave === EVIDENCE
          ? await captureReplay(h, "growth", () => collectWave(h, wave))
          : await collectWave(h, wave);
      const pool = healthPool(released);

      if (previous !== null) {
        assertGreaterThanOrEqual(
          pool,
          previous.pool,
          `wave ${wave}'s pool against wave ${previous.wave}'s ` +
            `${previous.pool}, summed over every unit's maximum health`,
        );
      }
      previous = { wave, pool };
    }
  }
});
