// bands/match-destroys — a matching shot destroys a drone.
//
// specs/bands.md, "Your shots: match to destroy": "When one of the player's
// bullets contacts a drone, the two effective bands decide the outcome, and
// nothing else does", and the first row of its table — "The bullet's effective
// band equals the drone's | The drone's exposed layer is destroyed, and the
// bullet is consumed". This point reads the DRONE half of that row; the bullet
// half is `bands.mismatch-consumes-bullet`'s.
//
// THE WORLD IS ONE SHARD AND ONE SHOT. `startPosed` empties the three rosters and
// shuts the three world gates, so nothing enters, nothing dives and nothing
// reaches the ship while the shot is in flight. Nothing is turned back on: the
// requirement is a contact between a bullet and a drone, which neither wave
// entry, nor dive launching, nor the ship's contact test has any part in.
//
// THE TARGET IS A SHARD WITH EVERY FACULTY OFF. A Shard is the one kind whose
// effective band is its stored band outright — a Prism's shell and a Flux's
// shimmer are each a swap of their own, and each is graded by its own point — so
// posing one is what makes this reading about the match rule and nothing else.
// `poseDrone` leaves travel, oscillation and fire off, so the target stands
// still, holds its band, and fires nothing.
//
// NEITHER BAND IS SWAPPED. No inversion is posed (`startPosed` leaves it at `0`),
// the Shard's shell is not a thing, and a player bullet is never inverted, so
// both effective bands are the stored ones and "cyan against cyan" is a match by
// the definition in specs/bands.md rather than by an accident of the arrangement.
//
// THE SHOT IS FLOWN A FRAME AT A TIME, and the still is kept while the bullet is
// closing rather than after it lands. specs/stages.md clears a stage "on the
// moment its last drone is destroyed", and the drone this scenario poses is the
// only one on the field, so the frame the shot lands is also the frame the wave
// gives way to the stage-cleared screen — a picture in which the shot, the
// target, and the field are all already gone. What the flight itself costs is
// nothing: `fireAt` would run the same {@link FLIGHT_TICKS} frames in one call.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../../src/constants";
import { assertNull, assertTrue } from "../assert";
import {
  LANE_CENTER,
  SHOT_GAP,
  captureStill,
  createHarness,
  findBullet,
  findDrone,
  lastBullet,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the target stands, in logical units.
 *
 * Well inside the play field on both axes (`y` in `[64, 656]`, specs/field.md),
 * clear of both HUD strips and far above the ship's lane at `SHIP_Y` (`600`), so
 * the only thing the shot can meet on its way is the drone it was fired at.
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 320;

/** The band both the drone and the shot carry: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * How long the shot is flown, in frames of the 120 Hz clock.
 *
 * Derived, not chosen: the bullet is placed `SHOT_GAP` (`60`) units below the
 * target and climbs at `PLAYER_BULLET_SPEED` (`760`, specs/ship.md), so this is
 * the whole of the flight. It is the same span `fireAt` would run.
 */
const FLIGHT_TICKS = ticksFor(SHOT_GAP / PLAYER_BULLET_SPEED);

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/**
 * How near the target the shot gets before the still is kept, in logical units.
 *
 * Twice the overlap distance: the frame the matching shot is bearing down on the
 * drone and about to reach it.
 */
const CLOSING = 2 * TOUCHING;

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

  h.debug.addPlayerBullet(TARGET_X, TARGET_Y + SHOT_GAP, MATCHING_BAND);
  const bulletId = lastBullet(h.snapshot()).id;

  let captured = false;
  for (let frame = 0; frame < FLIGHT_TICKS; frame += 1) {
    await h.advance(1);
    const field = h.snapshot();
    const target = findDrone(field, droneId);
    const shot = findBullet(field, bulletId);
    if (
      !captured &&
      target !== null &&
      shot !== null &&
      shot.y - target.y <= CLOSING
    ) {
      captureStill(h, "destroyed");
      captured = true;
    }
    if (target === null) break;
  }

  assertTrue(
    captured,
    `the ${MATCHING_BAND} Shard still standing with the shot closed to within ` +
      `${CLOSING} units of it — a target that was never posed, or that left ` +
      "the roster before the bullet arrived, would read as destroyed below " +
      "without the contact this point is about ever happening",
  );
  assertNull(
    findDrone(h.snapshot(), droneId),
    `the ${MATCHING_BAND} Shard is gone from the roster after one ` +
      `${MATCHING_BAND} bullet climbed ${SHOT_GAP} units at ` +
      `PLAYER_BULLET_SPEED ${PLAYER_BULLET_SPEED} into its ${TOUCHING}-unit ` +
      "contact reach — specs/bands.md: a bullet whose effective band equals " +
      "the drone's destroys the drone's exposed layer",
  );
});
