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
// A BYSTANDER STANDS THROUGHOUT, for the reason `poseBystander` gives: without a
// second drone on the field a build that reads a stage's wave as the drones
// standing on it would clear the stage on the kill below and pay
// `SCORE_STAGE_CLEAR` into the score being watched.
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
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
  START_LIVES,
  slotX,
  slotY,
} from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertUndefined,
} from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  fireAt,
  poseDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";
import { poseBystander } from "./lives";

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
 * Where the target Shard stands: a slot of the formation grid four columns from
 * the bystander's and well above the ship's lane, so the shot's climb meets
 * nothing but the drone it was fired at.
 */
const TARGET_X = slotX(4);
const TARGET_Y = slotY(1);

/** The band the target holds and the shot carries: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * How close two centres come for the circles to overlap, in logical units.
 *
 * specs/simulation.md decides a contact as an overlap of two circles of the
 * half-extents their own specs state: `SHARD_HALF` (`14`, specs/drones.md) and
 * `PLAYER_BULLET_HALF` (`6`, specs/ship.md).
 */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the contact reach, so the bullet starts well clear of the drone and
 * the kill this point rests on is one the FLIGHT produced rather than one the
 * placement did. It puts the shot at `y = 328`, inside the play field
 * (specs/field.md) and well above the ship's lane at `SHIP_Y` (`600`).
 */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * `SHOT_BELOW - TOUCHING` = 120 units of climb bring the bullet inside the
 * contact reach, which is 16 frames of the harness's 100 Hz clock at
 * `PLAYER_BULLET_SPEED` (`760`, specs/ship.md). Thirty leaves fourteen frames of
 * slack for whichever sub-step a build resolves the contact on, and still leaves
 * a shot that missed above `FIELD_TOP` (`64`) rather than off the field.
 */
const FLIGHT_TICKS = 30;

/**
 * Frames run after the shot resolved, before the award is read.
 *
 * specs/progression.md puts the award on the scoring, so a build pays it on the
 * frame the score crossed; two frames leave room for one that resolves the award
 * in the update after the one that scored. Nothing else can happen in them: the
 * field holds one inert bystander, the three world gates are shut and no key is
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
  poseBystander(h);
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
  await fireAt(h, TARGET_X, TARGET_Y, MATCHING_BAND, SHOT_BELOW, FLIGHT_TICKS);
  await h.advance(AWARD_TICKS);
  const after = h.snapshot();
  captureStill(h, "awarded");

  assertUndefined(
    droneById(after, target),
    `the ${MATCHING_BAND} Shard gone from the roster after a ${MATCHING_BAND} ` +
      `bullet climbed ${SHOT_BELOW} units at PLAYER_BULLET_SPEED ` +
      `${PLAYER_BULLET_SPEED} into its ${TOUCHING}-unit contact reach — the ` +
      "kill is the premise this point rests on (specs/bands.md)",
  );
  assertGreaterThanOrEqual(
    after.score,
    EXTRA_LIFE_AT,
    `the score after the kill, from ${POSED_SCORE} — the premise this point ` +
      "rests on is that scoring carried the run to EXTRA_LIFE_AT " +
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
