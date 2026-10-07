// load/wave-growth — a wave's health pool never falls.
//
// specs/enemies.md, under the rules a wave's composition obeys: "Growth — A
// wave's total health pool is at least that of the wave before it." A wave's
// pool is the sum of the maximum health of every unit it releases, which is
// `Σ count(t) × HP(t, w)` over the six roster types: the counts come off the
// wave's own schedule and `HP` is the per-wave scaling this project transcribes
// from specs/enemies.md and specs/difficulty.md, so every figure compared here is
// the validator's own.
//
// WHY THE POOL IS COMPUTED RATHER THAN SUMMED OFF SPAWNED UNITS. Two rules meet
// in a wave's pool — what the wave carries and what a unit of that type is worth
// at that wave — and they are two requirements. Reading `maxHp` off arrivals
// makes a build whose composition grows correctly but whose scaling is wrong fail
// HERE as well as at `load/health-scales-by-wave`, blaming the composer for the
// spawner's defect. Taking the scaling from this project's own constants leaves
// each defect failing its own check.
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
//
// WHAT IS READ is `waveCount` over the six roster types on the frame the harvest
// launched the wave: the live wave's own schedule, which is the array the spawner
// is working through (specs/instrumentation.md). That the schedule and what the
// spawner actually releases are the same thing is
// `instrumentation/wave-count-matches-the-spawner`'s requirement, decided once
// there over a wave driven to its clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import type { Harness } from "../harness";
import {
  composedWave,
  composedWaveOnCamera,
  createWaveHarness,
  poolOf,
} from "./waves";
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

afterEach(async () => {
  await h.dispose();
});

it("never releases a wave whose pool is smaller than the wave before it", async () => {
  for (const run of RUNS) {
    let previous: { wave: number; pool: number } | null = null;
    for (const wave of run) {
      const counts =
        wave === EVIDENCE
          ? await composedWaveOnCamera(h, wave, DIFFICULTY, "growth")
          : await composedWave(h, wave, DIFFICULTY);
      const pool = poolOf(counts, wave, DIFFICULTY);

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
