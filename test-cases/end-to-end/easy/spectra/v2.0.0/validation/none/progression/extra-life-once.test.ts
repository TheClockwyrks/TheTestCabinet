// progression/extra-life-once — a run pays its extra life once, and only once.
//
// `specs/progression.md`: "The run carries a latch recording whether that life
// has been paid... While the latch is true no further life is paid, whatever the
// score does afterwards."
//
// THE SCENARIO IS `progression/extra-life-awarded`'S, DIFFERING IN ONE VALUE. The
// latch is posed TRUE — a run that has already been paid — the score is posed one
// point below `EXTRA_LIFE_AT` (`20000`), and the same real kill carries it across
// the same threshold. There the run gains a life; here it must not. Posing one
// value and reading a different answer is what makes this item name the wrong
// model it caught: a build that pays on every crossing reads one life more.
//
// WHY THE LATCH IS POSED RATHER THAN THE SCORE LOWERED. The other way to stage a
// second crossing is to score past the threshold, pose the score back down, and
// score past it again — and that scenario passes a build holding a boolean latch
// while failing a build that compares the pre-scoring and post-scoring score
// against the threshold. Those two designs are indistinguishable in play, where a
// score never falls, so both are conformant and a check that separated them would
// be grading an implementation. `setExtraLifeAwarded` exists on the surface for
// exactly this reason (`specs/instrumentation.md`), and posing it puts both
// designs in the state the specification describes.
//
// WHAT THIS DOES NOT DECIDE. That the first crossing pays anything at all, which
// is `progression/extra-life-awarded`'s: a build that never pays passes here and
// fails there, and the pair grades the two directions apart.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertUndefined,
} from "../assert";
import { EXTRA_LIFE_AT, START_LIVES, slotX, slotY } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  requireDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The score the run is posed at, one point below `EXTRA_LIFE_AT` (`20000`).
 *
 * As close to the threshold as a whole number gets, so ANY score the build pays
 * for the kill carries the run across it, and this item does not depend on the
 * figure `specs/scoring.md` fixes for a formation Shard.
 */
const POSED_SCORE = EXTRA_LIFE_AT - 1;

/** Where the target Shard is posed: a slot of the formation grid, well clear
 * of the ship's lane. */
const TARGET_AT = { x: slotX(4), y: slotY(1) } as const;

/**
 * How far below the target the shot starts, in logical units.
 *
 * Clear of the Shard's own reach — `SHARD_HALF` (`14`) plus `PLAYER_BULLET_HALF`
 * (`6`), 20 units of centre separation — by a factor of ten, so the kill is one
 * the climb produced.
 */
const SHOT_BELOW = 200;

/**
 * Frames run after the shot resolved, before the lives are read.
 *
 * The same window `progression/extra-life-awarded` gives the award to land in, so
 * the two items read at the same moment and a build that pays a frame late is not
 * mistaken here for one that does not pay at all.
 */
const AWARD_FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds no further life when a later kill carries the score across again", async () => {
  await startPosed(h);
  const target = await poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y);
  await h.debug.setLives(START_LIVES);
  await h.debug.setScore(POSED_SCORE);
  // The one value that differs from `progression/extra-life-awarded`: this run
  // has already been paid.
  await h.debug.setExtraLifeAwarded(true);

  const posed = await h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the score the run was posed at");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");
  assertEqual(
    posed.extraLifeAwarded,
    true,
    "the latch as it was posed — a run that has already paid its extra life",
  );

  const targetBand = requireDrone(posed, target, "the shot's target").band;
  await shootDrone(h, target, targetBand, { below: SHOT_BELOW });
  await h.advance(AWARD_FRAMES);
  const after = await h.snapshot();
  await captureStill(h, "once");

  assertUndefined(
    droneById(after, target),
    "the target destroyed by the matching shot, which is what carries the " +
      "score across the threshold",
  );
  assertGreaterThanOrEqual(
    after.score,
    EXTRA_LIFE_AT,
    `the score after the kill, from ${String(POSED_SCORE)} — the premise this ` +
      "item rests on is that scoring carried the run to EXTRA_LIFE_AT " +
      `(${String(EXTRA_LIFE_AT)}) again (specs/progression.md)`,
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `the lives after a second crossing of EXTRA_LIFE_AT with the latch already ` +
      `true, from ${String(START_LIVES)} — while the latch is true no further ` +
      "life is paid (specs/progression.md)",
  );
  assertEqual(
    after.extraLifeAwarded,
    true,
    "the latch after the second crossing: it stays true (specs/progression.md)",
  );
});
