// Wireworm — instrumentation/set-score-grants-no-life: posing the score across a
// bonus-life boundary grants nothing.
//
// specs/instrumentation.md: "`setScore` grants no bonus life, whatever boundary it
// carries the score across: the award belongs to the scoring path, and this is a
// precondition." specs/scoring.md is the rule it is held apart from: a bonus life
// is granted as the score climbs, at every `BONUS_LIFE_EVERY` (`12,000`) points
// crossed THROUGH PLAY.
//
// WHY THE SUITE RESTS ON IT. A pose is how a scenario states where it starts, and
// half the `scoring` group poses a score to put the run just under a figure it is
// about. If posing one paid its award, every one of those scenarios would hand
// itself lives it never earned, and a `progression` point that reads the lives
// count afterwards would be reading the pose rather than the game.
//
// THE OTHER DIRECTION — that crossing the boundary through REAL scoring does grant
// a life — is `scoring.bonus-life`, so nothing here asserts that an award ever
// happens. This point asserts only that the precondition side never pays.
//
// TWO CROSSINGS, ONE EDGE. A pose that steps over a single boundary and a pose
// that vaults over several exercise the same edge the same way, so they share one
// check: whichever way a build computed an award from a score change, both land on
// it. A frame is advanced after each pose, so a build that deferred the award to
// the next update is caught as surely as one that paid it at the call.

import { afterEach, beforeEach, it } from "vitest";
import { BONUS_LIFE_EVERY, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** Just under the first boundary, and just over it. */
const UNDER = BONUS_LIFE_EVERY - 50;
const OVER = BONUS_LIFE_EVERY + 50;

/** Well past the third boundary, in one pose from the second. */
const FAR = BONUS_LIFE_EVERY * 3 + 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves lives exactly as they were across one boundary and across several", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);

  h.debug.setScore(UNDER);
  await h.advance(1);
  assertEqual(h.snapshot().score, UNDER, "the score the pose put the run at");
  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    "the lives the run started with",
  );

  // One boundary, stepped over.
  h.debug.setScore(OVER);
  await h.advance(1);
  // The posed score and the lives beside it.
  captureStill(h, "posed");
  assertEqual(
    h.snapshot().score,
    OVER,
    "setScore poses the score it was given",
  );
  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    `posing the score across BONUS_LIFE_EVERY (${String(BONUS_LIFE_EVERY)}) ` +
      "grants no bonus life (specs/instrumentation.md)",
  );

  // Several boundaries, vaulted over in one pose.
  h.debug.setScore(FAR);
  await h.advance(1);
  assertEqual(h.snapshot().score, FAR, "setScore poses the score it was given");
  assertEqual(
    h.snapshot().lives,
    START_LIVES,
    "posing the score across several boundaries at once grants none either " +
      "(specs/instrumentation.md)",
  );
});
