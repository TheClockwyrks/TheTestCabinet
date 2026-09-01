// field/player-bullet-leaves-field — one of the player's bullets is removed when it
// climbs out of the top of the play field.
//
// specs/field.md, "Crossing the edges": "A bullet that leaves the play field is
// removed: a player bullet whose center climbs above `FIELD_TOP`, and an enemy
// bullet whose center falls below `FIELD_BOTTOM`." The edge is the whole of the
// rule, so the check reads BOTH sides of it: the bullet is still on the roster while
// it is well inside the field, and it is off the roster once its centre has climbed
// past `FIELD_TOP`. A build that culls a bullet on a timer, or at the first row of
// the formation grid, or at the top of the drawn stage instead of the top of the
// field, fails the first half; a build that lets one climb into the HUD strip and
// stay there fails the second.
//
// THE FIELD IS EMPTY AND STAYS EMPTY. `startPosed` clears all four rosters and shuts
// the wave's three gates, so the one bullet this poses has nothing to hit on its way
// up and nothing arrives to hit it: whatever takes it off the roster is the edge.
// The bullet is put in flight by the surface rather than fired, so no cooldown,
// lockout or cap takes part, and it starts far enough down the field that its
// removal is one the FLIGHT reached rather than one the placement did.
//
// The other edge is the sibling `field/enemy-bullet-leaves-field`, so a build that
// removes everything at the top and nothing at the bottom grades differently from
// one that removes neither.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  PLAYER_BULLET_H,
  PLAYER_BULLET_SPEED,
} from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the bullet is put in flight: mid-field on the ship's own lane, 200 units
 * below `FIELD_TOP`.
 *
 * Far enough down that the climb is what carries it over the edge — a third of the
 * field's height stands between it and the strip — and clear of the formation grid's
 * rows (140 to 332) and of the ship's lane (600), so nothing else could account for
 * its removal.
 */
const START = { x: 640, y: FIELD_TOP + 200 } as const;

/**
 * How far the bullet's centre may still be BELOW `FIELD_TOP` on the last frame it
 * was seen alive, in logical units.
 *
 * One frame of flight at `PLAYER_BULLET_SPEED` (760) on the harness's 100 Hz clock
 * is 7.6 units, and the bullet's own drawn half-height, `PLAYER_BULLET_H / 2`, is
 * 8: together they cover both the frame the sweep samples on and a build that reads
 * the crossing off the bullet's leading edge rather than its centre. 24 is that sum
 * with room to spare, and it is under a third of the way back down to the
 * formation's top row — nowhere near enough for an early cull to hide in.
 */
const LEAVE_MARGIN = 24;

/**
 * Frames the climb is allowed.
 *
 * Twice the flight the placement leaves: the 200 units to the edge take 26 frames at
 * `PLAYER_BULLET_SPEED` (760), so a bullet still on the roster when the sweep ends
 * has climbed a clear 200 units PAST `FIELD_TOP` rather than merely run out of
 * frames.
 */
const CLIMB_FRAMES = ticksFor((START.y - FIELD_TOP) / PLAYER_BULLET_SPEED) * 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("takes a player bullet off the roster once its centre climbs above FIELD_TOP", async () => {
  startPosed(harness);
  const id = posePlayerBullet(harness, START.x, START.y, "cyan");

  // The last place the bullet was seen alive, sampled every frame so the reading is
  // never more than one frame of flight stale.
  let lastAlive = START.y;
  const swept = await harness.until(
    (snapshot) => {
      const bullet = bulletById(snapshot, id);
      if (bullet === undefined) return true;
      lastAlive = bullet.y;
      return false;
    },
    { maxFrames: CLIMB_FRAMES, poll: 1 },
  );
  captureStill(harness, "left");

  assertEqual(
    swept.hit,
    true,
    `the climbing bullet to leave the roster within ${String(CLIMB_FRAMES)} ` +
      `frames, which is twice the flight from y ${String(START.y)} to ` +
      `FIELD_TOP (${String(FIELD_TOP)}) (specs/field.md)`,
  );
  assertLessThanOrEqual(
    lastAlive - FIELD_TOP,
    LEAVE_MARGIN,
    `how far below FIELD_TOP (${String(FIELD_TOP)}) the bullet's centre still ` +
      `was on the last frame it was on the roster, allowing one frame of flight ` +
      `and the bullet's own ${String(PLAYER_BULLET_H / 2)}-unit drawn ` +
      `half-height (specs/field.md)`,
  );
});
