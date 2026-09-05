// load/air-cadence — Filaments arrive every fourth wave and on no other.
//
// specs/enemies.md, under the rules a wave's composition obeys: "Air cadence — A
// wave whose number is a multiple of `4` carries Filaments. No other wave
// carries a Filament." The Filament is the roster's one flyer, so the rule is
// what decides when the maze stops mattering and coverage under the straight
// line does.
//
// The rule runs in both directions, and both are read here off waves the game
// composed and launched itself: every fourth wave's schedule holds at least one
// Filament, and no other wave's holds any. The sample walks the run's first
// twelve waves, which holds three multiples of four and nine waves that are not,
// and then reaches the end of the run — `39` and `40` — so a build
// whose cadence drifts or stops late fails here rather than passing on an
// opening that happened to be right.
//
// WHAT IS READ is `waveCount("filament")` on the frame the harvest launched the
// wave: the live wave's own schedule, which is the array the spawner is working
// through (specs/instrumentation.md). That the schedule and what the spawner
// actually releases are the same thing is `instrumentation/wave-count-matches-the-
// spawner`'s requirement, decided once there over a wave driven to its clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import type { Harness } from "../harness";
import {
  composedWave,
  composedWaveOnCamera,
  countIn,
  createWaveHarness,
} from "./waves";

/** The run this check reads. Every difficulty runs the same cadence rule. */
const DIFFICULTY = "easy";

/** The waves read: the run's opening twelve, and three from its back half. */
const SAMPLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 39, 40];

/** The wave whose arrival is kept as the clip: the first one that flies. */
const EVIDENCE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries Filaments on every fourth wave and on no other", async () => {
  for (const wave of SAMPLE) {
    const counts =
      wave === EVIDENCE
        ? await composedWaveOnCamera(h, wave, DIFFICULTY, "air")
        : composedWave(h, wave, DIFFICULTY);

    const flyers = countIn(counts, "filament");
    if (wave % 4 === 0) {
      assertEqual(
        flyers > 0,
        true,
        `wave ${wave} is a multiple of 4 and carries Filaments; its schedule ` +
          `holds no Filament`,
      );
    } else {
      assertEqual(
        flyers,
        0,
        `wave ${wave} is not a multiple of 4, so it carries no Filament`,
      );
    }
  }
});
