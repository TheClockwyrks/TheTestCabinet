// scoring/best-rises-live — the best score rises on the tick the score passes it,
// during play.
//
// specs/scoring.md: "`BEST` is the highest score reached in the current session.
// It rises the instant the live score passes it, during play rather than at the
// end of a round." So the reading is taken on the very tick that overtakes the
// best, with the round still live: a build that only settles the best when a
// round ends still reports the old figure here.
//
// The margin is one eat. The score is posed five points under the best and the
// eat is worth `PELLET_POINTS` at a closed window, so the tick crosses the best
// by five and by nothing else, and the best after it is the score after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PELLET_POINTS } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The best the session is carrying when the tick begins. */
const BEST = 100;

/** The score the tick begins on: one eat carries it five past the best. */
const SCORE = BEST - PELLET_POINTS + 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the best to the score on the tick the score overtakes it", async () => {
  const posed = await arrangeEat(h, {
    score: SCORE,
    best: BEST,
    combo: 1,
    comboWindow: 0,
  });
  assertEqual(posed.snapshot.best, BEST, "the best the round is carrying");

  const after = await captureReplay(h, "best", () => h.tick());

  assertEqual(after.screen, "playing", "the screen the reading is taken on");
  assertEqual(after.score, SCORE + PELLET_POINTS, "the score after the eat");
  assertEqual(after.best, after.score, "the best on the tick that overtook it");
});
