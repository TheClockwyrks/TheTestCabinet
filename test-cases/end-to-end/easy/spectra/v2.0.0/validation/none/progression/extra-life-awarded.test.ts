// progression/extra-life-awarded — the run pays its one extra life at EXTRA_LIFE_AT.
//
// `specs/progression.md`: "A run pays exactly one extra life, when the score
// first reaches `EXTRA_LIFE_AT` (`20000`). The run carries a latch recording
// whether that life has been paid... When scoring carries the score to
// `EXTRA_LIFE_AT` or beyond and the latch is false, the run adds one life and
// sets the latch true."
//
// THE CROSSING IS REAL, NOT POSED. `specs/instrumentation.md` is explicit that
// `setScore` "grants no extra life, whatever boundary it carries the score
// across: the award belongs to the scoring path, and this is a precondition." So
// the score is posed to one point BELOW the threshold and the crossing is made by
// destroying a drone with a matching shot — the build's own scoring path, at
// whatever figure it pays. One point below is what makes the check independent of
// that figure: any positive score at all carries the run over.
//
// THE LATCH IS POSED DOWN rather than left where it happens to sit. It is false
// after a `reset` and after `startPosed`, but posing it explicitly is what makes
// this item and `progression/extra-life-once` the same scenario differing in one
// value, so a build that reads the latch and a build that ignores it grade
// differently.
//
// WHAT THIS DOES NOT DECIDE. What a Shard is worth (`scoring/shard-formation`'s),
// nor that a matching shot destroys it (`bands/`'s). Both are read here only as
// the premise that the score really did cross.

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
 * for the kill carries the run across it. A larger gap would make this item
 * depend on the figure `specs/scoring.md` fixes for a formation Shard, which is
 * another item's business.
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
 * the climb produced. The bullet's whole flight is inside the field, from
 * `y = 388` to the target at `188`.
 */
const SHOT_BELOW = 200;

/**
 * Frames run after the shot resolved, before the award is read.
 *
 * `specs/progression.md` puts the award on the scoring, so a build pays it on the
 * frame the score crossed; two frames leave room for one that resolves the award
 * in the update after the one that scored. Nothing else can happen in them: the
 * field holds nothing but the ship, the world gates are shut and no key is held.
 */
const AWARD_FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds exactly one life and latches when a kill carries the score across", async () => {
  await startPosed(h);
  const target = await poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y);
  await h.debug.setLives(START_LIVES);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setExtraLifeAwarded(false);

  const posed = await h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the score the run was posed at");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");
  assertEqual(
    posed.extraLifeAwarded,
    false,
    "the latch as it was posed — a run that has not yet paid its extra life",
  );

  // The build's own scoring path: a matching shot, climbing into the drone. The
  // band is the drone's own, read off the snapshot, since whether a matching shot
  // destroys a drone is `bands/`'s question rather than this one's.
  const targetBand = requireDrone(posed, target, "the shot's target").band;
  await shootDrone(h, target, targetBand, { below: SHOT_BELOW });
  await h.advance(AWARD_FRAMES);
  const after = await h.snapshot();
  await captureStill(h, "awarded");

  assertUndefined(
    droneById(after, target),
    "the target destroyed by the matching shot, which is what carries the " +
      "score across the threshold",
  );
  assertGreaterThanOrEqual(
    after.score,
    EXTRA_LIFE_AT,
    `the score after the kill, from ${String(POSED_SCORE)} — the premise this ` +
      `item rests on is that scoring carried the run to EXTRA_LIFE_AT ` +
      `(${String(EXTRA_LIFE_AT)}) (specs/progression.md)`,
  );
  assertEqual(
    after.lives,
    START_LIVES + 1,
    `the lives after the score first reached EXTRA_LIFE_AT with the latch ` +
      `down, from ${String(START_LIVES)} — a run pays exactly one extra life ` +
      "(specs/progression.md)",
  );
  assertEqual(
    after.extraLifeAwarded,
    true,
    "the latch after the award: the run sets it true when it pays " +
      "(specs/progression.md)",
  );
});
