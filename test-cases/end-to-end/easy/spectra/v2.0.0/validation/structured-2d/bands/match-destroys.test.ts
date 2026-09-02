// bands/match-destroys — a matching shot destroys a drone.
//
// specs/bands.md, "Your shots: match to destroy": "When one of the player's
// bullets contacts a drone, the two effective bands decide the outcome, and
// nothing else does", and the first row of its table — "The bullet's effective
// band equals the drone's | The drone's exposed layer is destroyed, and the
// bullet is consumed". This point reads the DRONE half of that row alone; the
// bullet half belongs to `bands.mismatch-consumes-bullet`.
//
// THE WORLD IS ONE SHARD AND ONE SHOT. `startPosed` empties the three rosters and
// shuts the three world gates, so nothing enters, nothing dives, and nothing
// reaches the ship while the shot is in flight. No gate is turned back on: the
// requirement is a contact between a bullet and a drone, in which neither wave
// entry, nor dive launching, nor the ship's contact test has any part.
//
// THE TARGET IS A SHARD WITH EVERY FACULTY OFF. A Shard is the one kind whose
// effective band is its stored band outright — a Prism's shell and a Flux's
// shimmer are each a swap of their own, graded by their own points — so posing
// one is what makes this reading about the match rule and nothing else.
// `poseDrone` leaves travel, oscillation and fire off, so the target stands
// still, holds its band and fires nothing.
//
// NEITHER BAND IS SWAPPED. `startPosed` leaves `inversion` at `0`, a Shard has no
// shell and no shimmer, and a player bullet is never inverted, so both effective
// bands are the stored ones and "cyan against cyan" is a match by the definition
// in specs/bands.md rather than by an accident of the arrangement.
//
// THE OPPOSITE DIRECTION is the sibling `bands.mismatch-spares`, which fires the
// other band into this same posture: a build that destroys on every contact and
// one that destroys on none grade differently rather than averaging out.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../constants";
import { assertDefined, assertUndefined } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the target stands, in logical units.
 *
 * Well inside the play field on both axes (`y` in `[64, 656]`, specs/field.md),
 * clear of both HUD strips and far above the ship's lane at `SHIP_Y` (`600`), so
 * the only thing the shot can meet on the way is the drone it was fired at.
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 320;

/** The band both the drone and the shot carry: a match by specs/bands.md. */
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
 * the contact the check reads is one the FLIGHT produced rather than one the
 * placement did.
 */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * How near the target the still is kept, in logical units.
 *
 * Twice the contact reach: the frame the matching shot is bearing down on the
 * drone and about to reach it. The picture is kept there rather than after the
 * contact because this scenario destroys the only drone on the field, and
 * specs/stages.md clears a stage "in the moment the last drone of its wave is
 * destroyed" — so the frame after the shot lands is the stage-cleared
 * interstitial, in which the shot, the target and the field are all already gone.
 */
const CLOSING = 2 * TOUCHING;

/**
 * Frames flown before the still is kept.
 *
 * The climb from `SHOT_BELOW` to `CLOSING` at `PLAYER_BULLET_SPEED` (`760`,
 * specs/ship.md). Nothing is asserted at this point: the span decides only where
 * the picture is taken, and a build whose shot travels at some other speed is
 * graded by the verdict below rather than by its own photograph.
 */
const CLOSING_TICKS = ticksFor((SHOT_BELOW - CLOSING) / PLAYER_BULLET_SPEED);

/**
 * Frames the whole flight is allowed.
 *
 * `SHOT_BELOW - TOUCHING` = 120 units of climb bring the bullet inside the
 * contact reach, which is 16 frames of the harness's 100 Hz clock at
 * `PLAYER_BULLET_SPEED`. Thirty leaves fourteen frames of slack for whichever
 * sub-step a build resolves the contact on, and still ends 88 units short of the
 * target's far side rather than at the top of the field.
 */
const FLIGHT_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a cyan Shard with a cyan shot", async () => {
  startPosed(h);
  const droneId = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: MATCHING_BAND,
  });
  posePlayerBullet(h, TARGET_X, TARGET_Y + SHOT_BELOW, MATCHING_BAND);

  await h.advance(CLOSING_TICKS);
  captureStill(h, "destroyed");

  assertDefined(
    droneById(h.snapshot(), droneId),
    "the target still standing while the shot is closing, so the removal " +
      "below is the contact's doing and not the placement's",
  );

  await h.advance(FLIGHT_TICKS - CLOSING_TICKS);

  assertUndefined(
    droneById(h.snapshot(), droneId),
    `the cyan Shard a cyan shot destroyed, after one bullet climbed ` +
      `${SHOT_BELOW} units at PLAYER_BULLET_SPEED ${PLAYER_BULLET_SPEED} into ` +
      `its ${TOUCHING}-unit contact reach (specs/bands.md)`,
  );
});
