// economy/wave-clear-score — clearing wave w scores 100 * w.
//
// specs/economy.md's score table: "A wave cleared" is worth `SCORE_WAVE_CLEAR * w`,
// "which is `100 * w` for wave `w`". specs/waves.md fixes the frame: "A wave clears
// on the frame in which its last live unit dies or leaks with none of it left to
// release ... On that frame the wave-clear bonus and its score are paid".
//
// THIS IS THE SCORE, AND ONLY THE SCORE. The money side of the same transition is
// `economy.wave-clear-bonus`'s. Interest, the other thing that transition can pay,
// is paid in money alone, and a leak scores nothing — so a leak-cleared wave moves
// the score by this one figure and by nothing else, and this point can be read in
// the standard mode with no arrangement to keep the money quiet.
//
// THREE WAVES, BECAUSE ONE READING CANNOT TELL A LINE FROM A CONSTANT. Wave `1`
// scores `100`, wave `7` scores `700`, and wave `19` scores `1900`. A build that
// scores a flat hundred reads the same figure three times; one that scores for the
// wave it is about to open reads `200`, `800` and `2000`. Wave `1` is where a
// per-wave figure and a flat one agree, which is exactly why it is not read alone.
//
// EACH WAVE IS CLEARED BY A LEAK, which scores nothing of its own
// (economy/payment.ts), so no bounty enters the reading. Each leg opens from
// `startRun`, which resets first and restores the score to `0` along with every
// other declared field, so a leg is a fresh run rather than a clear posed on top of
// the last one's.
//
// THE WAVES READ ARE ALL BELOW THE RUN'S LAST. Containment Medium runs twenty waves
// (specs/modes.md), so clearing `1`, `7` or `19` opens a build phase rather than the
// victory screen, and the victory bonus — `250` for every life left — is nowhere in
// this reading.
//
// WHAT EVERY WRONG MODEL READS. A build scoring a flat `100` reads `(100, 100, 100)`;
// one scoring `100 * (w + 1)` reads `(200, 800, 2000)`; one scoring the wave number
// itself reads `(1, 7, 19)`; one scoring nothing reads `(0, 0, 0)`. None is
// `(100, 700, 1900)`.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_WAVE_CLEAR } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./payment";

/** The waves whose clears are read: the run's first, an early one, its last ordinary one. */
const WAVES: readonly number[] = [1, 7, 19];

/**
 * What clearing wave `w` must score, to the point.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number of
 * points and specs/economy.md fixes the figure exactly, so the assertion is
 * equality.
 */
function expectedScore(wave: number): number {
  return SCORE_WAVE_CLEAR * wave;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Open a fresh run at the end of wave `wave`, leak its last unit away, and hand
 * back what the clear scored.
 */
async function clearFor(
  wave: number,
): Promise<{ scored: number; cleared: boolean }> {
  startRun(h);
  poseWaveEnd(h, wave);
  poseLeaker(h);

  const before = h.snapshot().score;
  const cleared = await runUntilLeaked(h);
  return { scored: h.snapshot().score - before, cleared };
}

it("adds 100 times the wave number to the score on the frame it clears", async () => {
  const scored: number[] = [];
  for (const wave of WAVES) {
    const leg = await clearFor(wave);
    assertTrue(
      leg.cleared,
      `precondition: wave ${wave}'s last unit left the floor`,
    );
    scored.push(leg.scored);
  }

  captureStill(h, "score");
  for (const [index, wave] of WAVES.entries()) {
    assertEqual(
      scored[index],
      expectedScore(wave),
      `the score clearing wave ${wave} paid`,
    );
  }
});
