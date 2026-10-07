// progression/extra-life-awarded — the run pays its one extra life at EXTRA_LIFE_AT.
//
// specs/progression.md: "A run pays exactly one extra life, when the score first
// reaches `EXTRA_LIFE_AT` (`20000`). The run carries a latch recording whether
// that life has been paid... When scoring carries the score to `EXTRA_LIFE_AT` or
// beyond and the latch is false, the run adds one life and sets the latch true."
//
// THE CROSSING IS REAL, NOT POSED. specs/instrumentation.md is explicit that
// `setScore` "grants no extra life, whatever boundary it carries the score
// across: the award belongs to the scoring path, and this is a precondition." So
// the score is posed ONE POINT BELOW the threshold and the crossing is made by
// destroying a drone with a matching shot — the build's own scoring path, at
// whatever figure it pays. One point below is what makes this point independent
// of that figure: any positive score at all carries the run over, so this never
// becomes a second reading of `scoring.shard-formation`.
//
// THE LATCH IS POSED DOWN rather than left where it happens to sit. It is false
// after `startPosed`, but posing it explicitly is what makes this point and
// `progression.extra-life-once` the same scenario differing in ONE VALUE, so a
// build that reads the latch and a build that ignores it grade differently.
//
// THE TARGET IS A SHARD WITH EVERY FACULTY OFF, shot with its own band. A Shard
// is the one kind whose effective band is its stored band outright — a Prism's
// shell and a Flux's shimmer are each a swap of their own — so the kill is the
// plainest one specs/bands.md defines.
//
// WHAT THIS DOES NOT DECIDE. What a Shard is worth (`scoring.shard-formation`'s),
// nor that a matching shot destroys it (`bands.match-destroys`'s). Both are read
// here only as the premise that the score really did cross.

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
 * for the kill carries the run across it. A larger gap would make this point
 * depend on the figure specs/scoring.md fixes for a formation Shard, which is
 * another point's business.
 */
const POSED_SCORE = EXTRA_LIFE_AT - 1;

/**
 * Where the target Shard stands: a slot of the formation grid well above the
 * ship's lane, so the shot's climb meets nothing but the drone it was fired at.
 */
const TARGET_X = slotX(4);
const TARGET_Y = slotY(1);

/** The band the target holds and the shot carries: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * Frames run after the shot resolved, before the award is read.
 *
 * specs/progression.md puts the award on the scoring, so a build pays it on the
 * frame the score crossed; two frames leave room for one that resolves the award
 * in the update after the one that scored. Nothing else can happen in them: the
 * field holds nothing but the ship, the four world gates are shut and no key is
 * held.
 */
const AWARD_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly one life and latches when a kill carries the score across", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: MATCHING_BAND,
  });
  h.debug.setLives(START_LIVES);
  h.debug.setScore(POSED_SCORE);
  // The one value that separates this point from `progression.extra-life-once`:
  // a run that has not yet paid its extra life.
  h.debug.setExtraLifeAwarded(false);

  const posed = h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the score the run was posed at");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");
  assertEqual(
    posed.extraLifeAwarded,
    false,
    "the latch as it was posed — a run that has not yet paid its extra life",
  );

  // The build's own scoring path: a matching shot, climbing into the drone.
  await fireAt(h, TARGET_X, TARGET_Y, MATCHING_BAND);
  await h.advance(AWARD_TICKS);
  const after = h.snapshot();
  captureStill(h, "awarded");

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
      `rests on is that scoring carried the run to EXTRA_LIFE_AT ` +
      `${EXTRA_LIFE_AT} (specs/progression.md)`,
  );
  assertEqual(
    after.lives,
    START_LIVES + 1,
    `the lives ${seconds(AWARD_TICKS)} s after the score first reached ` +
      `EXTRA_LIFE_AT ${EXTRA_LIFE_AT} with the latch down, from ` +
      `${START_LIVES} — specs/progression.md: the run adds one life. ` +
      `${START_LIVES} is a build that never pays the extra life at all`,
  );
  assertEqual(
    after.extraLifeAwarded,
    true,
    "the latch after the award — specs/progression.md: the run sets it true " +
      "when it pays, and while it is true no further life is paid",
  );
});
