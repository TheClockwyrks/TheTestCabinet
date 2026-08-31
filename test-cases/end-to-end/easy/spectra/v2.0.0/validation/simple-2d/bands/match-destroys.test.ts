// bands/match-destroys — a matching shot destroys a drone.
//
// specs/bands.md, "Your shots: match to destroy": "When one of the player's
// bullets contacts a drone, the two effective bands decide the outcome, and
// nothing else does", and the first row of its table — "The bullet's effective
// band equals the drone's | The drone's exposed layer is destroyed, and the
// bullet is consumed". This point reads the DRONE half of that row; the bullet
// half is `bands.mismatch-consumes-bullet`'s and `sortie`'s.
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

import { afterEach, beforeEach, it } from "vitest";
import { PLAYER_BULLET_SPEED, SHARD_HALF } from "../../src/constants";
import { assertNull } from "../assert";
import {
  LANE_CENTER,
  SHOT_GAP,
  captureStill,
  createHarness,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
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

  await fireAt(h, TARGET_X, TARGET_Y, MATCHING_BAND);
  captureStill(h, "destroyed");

  assertNull(
    findDrone(h.snapshot(), droneId),
    `the ${MATCHING_BAND} Shard is gone from the roster after one ` +
      `${MATCHING_BAND} bullet climbed ${SHOT_GAP} units at ` +
      `PLAYER_BULLET_SPEED ${PLAYER_BULLET_SPEED} into its ${SHARD_HALF}-unit ` +
      "contact circle — specs/bands.md: a bullet whose effective band equals " +
      "the drone's destroys the drone's exposed layer",
  );
});
