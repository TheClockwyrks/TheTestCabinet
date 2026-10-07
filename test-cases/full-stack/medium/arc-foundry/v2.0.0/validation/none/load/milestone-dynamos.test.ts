// load/milestone-dynamos — one Dynamo on wave round(N / 2) and one on wave N.
//
// specs/enemies.md: "Milestone bosses — Wave `round(N / 2)` and wave `N` each
// carry exactly one Dynamo. No other wave carries one." specs/campaign.md says
// the same from the campaign's side, and specs/difficulty.md tabulates the two
// waves per difficulty: on the `40`-wave run read here they are `20` and `40`.
//
// Both halves of the rule are read off waves the game composed and launched
// itself: exactly one Dynamo on each of the two milestones, and none anywhere
// else. The sample takes the run's opening six waves, the two waves on either
// side of the middle milestone, and the two on either side of the last, so a
// build that anchors the milestone one wave early fails on the wave it moved it
// to.
//
// The Overload Dynamo of the finale is a different unit from this boss
// (specs/enemies.md), and it is never released by a wave, so nothing here counts
// it.
//
// WHAT IS READ is `waveCount("dynamo")` on the frame the harvest launched the
// wave: the live wave's own schedule, which is the array the spawner is working
// through (specs/instrumentation.md). That the schedule and what the spawner
// actually releases are the same thing is `instrumentation/wave-count-matches-the-
// spawner`'s requirement, decided once there over a wave driven to its clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import type { FoundrySnapshot, Harness } from "../harness";
import {
  composedWave,
  composedWaveOnCamera,
  countIn,
  createWaveHarness,
} from "./waves";
import { difficultyById, milestoneWaves } from "../constants";

const DIFFICULTY = "easy";
const [MIDDLE, LAST] = milestoneWaves(difficultyById(DIFFICULTY).waves);

/** The opening waves, then the neighbourhood of each milestone. */
const SAMPLE = [
  1,
  2,
  3,
  4,
  5,
  6,
  MIDDLE - 1,
  MIDDLE,
  MIDDLE + 1,
  LAST - 1,
  LAST,
];

/**
 * What the clip has to hold before it is filmed: the milestone's Dynamo, on the
 * yard.
 *
 * `test-case.toml` names this output "The milestone Dynamo arriving", and WHERE
 * inside its wave a build releases the boss is the build's own choice —
 * specs/enemies.md anchors a Dynamo to the milestone and says nothing about when in
 * the wave it is released — so the clip waits for it rather than filming a fixed
 * opening that may not hold it.
 */
const SHOWING = (s: FoundrySnapshot): boolean =>
  s.units.some((unit) => unit.type === "dynamo");

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("anchors exactly one Dynamo on each milestone and none on any other wave", async () => {
  for (const wave of SAMPLE) {
    const counts =
      wave === MIDDLE
        ? await composedWaveOnCamera(h, wave, DIFFICULTY, "milestone", SHOWING)
        : await composedWave(h, wave, DIFFICULTY);

    assertEqual(
      countIn(counts, "dynamo"),
      wave === MIDDLE || wave === LAST ? 1 : 0,
      `wave ${wave} of ${difficultyById(DIFFICULTY).waves}, whose milestones ` +
        `are ${MIDDLE} and ${LAST}`,
    );
  }
});
