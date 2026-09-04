// progression/extra-life-once — a run pays its extra life once, and only once.
//
// specs/progression.md: "The run carries a latch recording whether that life has
// been paid... While the latch is true no further life is paid, whatever the
// score does afterwards."
//
// THE SCENARIO IS `progression.extra-life-awarded`'S, DIFFERING IN ONE VALUE. The
// latch is posed TRUE — a run that has already been paid — the score is posed one
// point below `EXTRA_LIFE_AT` (`20000`), and the same real kill carries it across
// the same threshold. There the run gains a life; here it must not. Posing one
// value and requiring a different answer is what makes this point name the wrong
// model it caught: a build that pays on every crossing reads one life more.
//
// WHY THE LATCH IS POSED RATHER THAN THE SCORE LOWERED. The other way to stage a
// second crossing is to score past the threshold, pose the score back down, and
// score past it again — and that scenario passes a build holding a boolean latch
// while failing a build that compares the pre-scoring and post-scoring score
// against the threshold. Those two designs are indistinguishable in play, where a
// score never falls, so both are conformant and a check that separated them would
// be grading an implementation. `setExtraLifeAwarded` is on the surface for
// exactly this reason (specs/instrumentation.md), and posing it puts both designs
// in the state the specification describes.
//
// THE CROSSING IS REAL, NOT POSED, for the reason specs/instrumentation.md gives:
// `setScore` "grants no extra life, whatever boundary it carries the score
// across". So the score is posed one point under the threshold and a matching
// shot destroys a Shard, and the build's own scoring path carries it over.
//
// WHAT THIS DOES NOT DECIDE. That the first crossing pays anything at all, which
// is `progression.extra-life-awarded`'s: a build that never pays passes here and
// fails there, and the pair grades the two directions apart.

import { afterEach, beforeEach, it } from "vitest";
import {
  EXTRA_LIFE_AT,
  PLAYER_BULLET_SPEED,
  START_LIVES,
  slotX,
  slotY,
} from "../constants";
import { assertEqual, assertGreaterThanOrEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  findDrone,
  poseDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The score the run is posed at, one point below `EXTRA_LIFE_AT` (`20000`).
 *
 * As close to the threshold as a whole number gets, so ANY score the build pays
 * for the kill carries the run across it, and this point does not depend on the
 * figure specs/scoring.md fixes for a formation Shard.
 */
const POSED_SCORE = EXTRA_LIFE_AT - 1;

/**
 * Where the target Shard stands: the same slot `progression.extra-life-awarded`
 * fires at, well above the ship's lane, so the two points differ in the latch
 * and in nothing else.
 */
const TARGET_X = slotX(4);
const TARGET_Y = slotY(1);

/** The band the target holds and the shot carries: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * Frames run after the shot resolved, before the lives are read.
 *
 * The same window `progression.extra-life-awarded` gives the award to land in, so
 * the two points read at the same moment and a build that pays a frame late is
 * not mistaken here for one that does not pay at all.
 */
const AWARD_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds no further life when a later kill carries the score across again", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: MATCHING_BAND,
  });
  h.debug.setLives(START_LIVES);
  h.debug.setScore(POSED_SCORE);
  // The one value that differs from `progression.extra-life-awarded`: this run
  // has already been paid.
  h.debug.setExtraLifeAwarded(true);

  const posed = h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the score the run was posed at");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");
  assertEqual(
    posed.extraLifeAwarded,
    true,
    "the latch as it was posed — a run that has already paid its extra life",
  );

  await fireAt(h, TARGET_X, TARGET_Y, MATCHING_BAND);
  await h.advance(AWARD_TICKS);
  const after = h.snapshot();
  captureStill(h, "once");

  assertNull(
    findDrone(after, target),
    `the ${MATCHING_BAND} Shard gone from the roster after a ${MATCHING_BAND} ` +
      `bullet climbed into it at PLAYER_BULLET_SPEED ${PLAYER_BULLET_SPEED} — ` +
      "the kill is the premise this point rests on (specs/bands.md)",
  );
  assertGreaterThanOrEqual(
    after.score,
    EXTRA_LIFE_AT,
    `the score after the kill, from ${POSED_SCORE} — the premise this point ` +
      "rests on is that scoring carried the run to EXTRA_LIFE_AT " +
      `${EXTRA_LIFE_AT} again (specs/progression.md)`,
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `the lives ${seconds(AWARD_TICKS)} s after a second crossing of ` +
      `EXTRA_LIFE_AT ${EXTRA_LIFE_AT} with the latch already true, from ` +
      `${START_LIVES} — specs/progression.md: while the latch is true no ` +
      `further life is paid. ${START_LIVES + 1} is a build that pays on every ` +
      "crossing",
  );
  assertEqual(
    after.extraLifeAwarded,
    true,
    "the latch after the second crossing — specs/progression.md: it stays true",
  );
});
