// load/milestone-dynamos — one Dynamo on wave round(N / 2) and one on wave N.
//
// specs/enemies.md: "Milestone bosses — Wave `round(N / 2)` and wave `N` each
// carry exactly one Dynamo. No other wave carries one." specs/campaign.md says
// the same from the campaign's side, and specs/difficulty.md tabulates the two
// waves per difficulty: on the `40`-wave run read here they are `20` and `40`.
//
// Both halves of the rule are read off waves the game composed itself: exactly
// one Dynamo on each of the two milestones, and none anywhere else. The sample
// takes the run's opening six waves, the two waves on either side of the middle
// milestone, and the two on either side of the last, so a build that anchors the
// milestone one wave early fails on the wave it moved it to.
//
// The Overload Dynamo of the finale is a different unit from this boss
// (specs/enemies.md), and it is never released by a wave, so nothing here counts
// it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, type Harness } from "../harness";
import { collectWave, countOf, createWaveHarness, openWave } from "./waves";
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

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(() => {
  h.dispose();
});

it("anchors exactly one Dynamo on each milestone and none on any other wave", async () => {
  for (const wave of SAMPLE) {
    openWave(h, wave, DIFFICULTY);
    const released =
      wave === MIDDLE
        ? await captureReplay(h, "milestone", () => collectWave(h, wave))
        : await collectWave(h, wave);

    assertEqual(
      countOf(released, "dynamo"),
      wave === MIDDLE || wave === LAST ? 1 : 0,
      `wave ${wave} of ${difficultyById(DIFFICULTY).waves}, whose milestones ` +
        `are ${MIDDLE} and ${LAST}`,
    );
  }
});
