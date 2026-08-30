// scoring/bonus-life — crossing a multiple of BONUS_LIFE_EVERY through play grants a life.
//
// specs/scoring.md: "One extra life is granted each time the score crosses a
// multiple of `BONUS_LIFE_EVERY` (`12,000`) through play." The score is posed `50`
// short of the first multiple and a REAL scoring event carries it across: a
// glitch's bounty of `SCORE_GLITCH` (`300`) takes `11,950` to `12,250`, which is
// over the boundary and well short of the next one, so exactly one multiple is
// crossed and exactly one life is owed.
//
// THE CROSSING IS MADE THROUGH PLAY. The other direction — that posing the score
// across the boundary with `setScore` grants nothing, because the award belongs to
// the scoring path — is `instrumentation.set-score-grants-no-life`, and the pose
// here is deliberately made SHORT of the boundary so the two never overlap.
//
// THE LIVES ARE POSED AT ONE rather than at the `START_LIVES` (`3`) a run opens
// with (specs/progression.md), so every wrong model reads as a different number: a
// build that grants no life reads `1`, one that grants a life per multiple crossed
// reads the `2` this point requires, and one that hands the run a fresh set of
// starting lives reads `3`.
//
// THE CHECK FIRST ESTABLISHES THAT THE SCORE ACTUALLY CROSSED. A build whose bolt
// resolved against nothing would leave the score at `11,950` and the lives at `1`,
// which is the same failure as never granting the life; the score reading
// separates the two, so a failure names which of them the build did.
//
// THE GLITCH STANDS STILL AND THINKS ABOUT NOTHING. Both faculties are off, so
// specs/instrumentation.md leaves its travel and its mind alike shut; neither has
// anything to do with the life the award earns, so the foe is on the tile the pose
// put it on when the bolt arrives and the shot is the only thing in the scenario.
//
// WHAT THIS DOES NOT DECIDE. That the kill pays `SCORE_GLITCH` is
// `scoring.glitch-bounty`'s requirement. This point reads the life alone, on the
// evidence that the boundary was crossed.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOLT_SPEED,
  BONUS_LIFE_EVERY,
  FOE_HALF,
  TILE,
} from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseFoe,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The score the run is posed at: `50` short of the first multiple of
 * `BONUS_LIFE_EVERY`, so the smallest figure the game pays carries it across and
 * the largest carries it across only that one multiple.
 */
const POSED_SCORE = BONUS_LIFE_EVERY - 50;

/** The lives standing before the award, and how many the crossing owes. */
const LIVES_BEFORE = 1;
const LIVES_GRANTED = 1;

/**
 * The tile the glitch is centred on.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so the shot is decided by the
 * foe alone.
 */
const FOE_C = 20;
const FOE_R = 10;

/** How far below the foe the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the foe, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve against a foe when "the bolt's centre is inside the foe's box,
 * `FOE_HALF` (`12`) units from the foe's centre on each axis". Posed four tiles
 * below the foe's centre, the bolt's centre starts `128` units under it and so
 * `116` units under the box's lower edge, which is `0.129` s of flight. Twice that
 * is the budget, so a conforming build has ample room and a build whose bolt never
 * resolves still reaches a verdict rather than running the suite out.
 */
const BOLT_TICKS =
  2 * ticksFor((BOLT_DROP_TILES * TILE - FOE_HALF) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("grants one life when real scoring carries the score across BONUS_LIFE_EVERY", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(LIVES_BEFORE);
  const glitch = poseFoe(h, "glitch", FOE_C, FOE_R);
  h.debug.setFoeTravel(glitch, false);
  h.debug.setFoeMind(glitch, false);

  poseBolt(h, FOE_C, FOE_R + BOLT_DROP_TILES);
  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "bonus");

  const after = h.snapshot();
  assertGreaterThanOrEqual(
    after.score,
    BONUS_LIFE_EVERY,
    "the kill to have carried the score across BONUS_LIFE_EVERY",
  );
  assertEqual(
    after.lives,
    LIVES_BEFORE + LIVES_GRANTED,
    "one extra life for the one multiple the award crossed",
  );
});
