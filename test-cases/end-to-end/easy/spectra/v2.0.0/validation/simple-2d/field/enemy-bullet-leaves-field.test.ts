// field/enemy-bullet-leaves-field — an enemy bullet is removed when it falls out of
// the bottom of the play field.
//
// specs/field.md, "Crossing the edges": "A bullet that leaves the play field is
// removed: a player bullet whose center climbs above `FIELD_TOP`, and an enemy
// bullet whose center falls below `FIELD_BOTTOM`." The edge is the whole of the
// rule, so the check reads BOTH sides of it: the bullet is still on the roster while
// it is well inside the field, and it is off the roster once its centre has fallen
// past `FIELD_BOTTOM`. A build that culls an enemy bullet on a timer, or at the
// ship's lane, or at the bottom of the drawn stage instead of the bottom of the
// field, fails the first half; a build that lets one fall into the HUD strip and
// stay there fails the second.
//
// THE FIELD IS EMPTY, AND THE BULLET FALLS DOWN A COLUMN THE SHIP IS NOT IN.
// `startPosed` clears all four rosters and shuts the wave's three gates — the ship's
// contact test among them, so even a build that put its hull in the way could not
// consume the bullet — and the bullet is dropped four hundred units to the ship's
// left, so it passes the lane with the whole hull well clear of it and the only
// thing that can take it off the roster is the edge. It is put in flight by the
// surface rather than fired, so no drone, dive or fire line takes part.
//
// The other edge is the sibling `field/player-bullet-leaves-field`.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_H,
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
} from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  findBullet,
  lastBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the bullet is dropped: 200 units above `FIELD_BOTTOM`, and 400 units to the
 * left of the centre of the ship's lane, where `startPosed` parks the ship.
 *
 * 400 units is ten times the ship's whole width, so the fall passes the lane with
 * the hull nowhere near it; and the drop is far enough above the edge that the
 * removal is one the fall reached rather than one the placement did.
 */
const START = { x: 240, y: FIELD_BOTTOM - 200 } as const;

/**
 * How far the bullet's centre may still be ABOVE `FIELD_BOTTOM` on the last frame it
 * was seen alive, in logical units.
 *
 * One frame of fall at `ENEMY_BULLET_SPEED` (320) times `bulletSpeedScale(1)` (1) on
 * the harness's 120 Hz clock is 2.67 units, and the bullet's own drawn half-height,
 * `ENEMY_BULLET_H / 2`, is 6: together they cover both the frame the sweep samples
 * on and a build that reads the crossing off the bullet's leading edge rather than
 * its centre. 24 is well over that sum and still only an eighth of the fall this
 * poses — nowhere near enough for an early cull to hide in.
 */
const LEAVE_MARGIN = 24;

/**
 * Frames the fall is allowed.
 *
 * Twice the fall the placement leaves: the 200 units to the edge take 75 frames at
 * the stage-1 `ENEMY_BULLET_SPEED`, so a bullet still on the roster when the sweep
 * ends has fallen a clear 200 units PAST `FIELD_BOTTOM` rather than merely run out
 * of frames.
 */
const FALL_FRAMES = ticksFor((FIELD_BOTTOM - START.y) / ENEMY_BULLET_SPEED) * 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("takes an enemy bullet off the roster once its centre falls below FIELD_BOTTOM", async () => {
  startPosed(harness);
  // The stage this poses is stage 1, where `bulletSpeedScale` is 1, so the bullet
  // the surface adds falls at exactly `ENEMY_BULLET_SPEED` and the frames below are
  // budgeted against the speed the fall really runs at.
  assertEqual(
    harness.snapshot().bulletSpeedScale,
    1,
    "the stage-1 enemy bullet speed scale the frames below are budgeted against",
  );
  harness.debug.addEnemyBullet(START.x, START.y, "magenta");
  const id = lastBullet(harness.snapshot()).id;

  // The last place the bullet was seen alive, sampled every frame so the reading is
  // never more than one frame of fall stale.
  let lastAlive = START.y;
  const swept = await harness.until(
    (snapshot) => {
      const bullet = findBullet(snapshot, id);
      if (bullet === null) return true;
      lastAlive = bullet.y;
      return false;
    },
    { maxFrames: FALL_FRAMES, poll: 1 },
  );
  captureStill(harness, "left");

  assertEqual(
    swept.hit,
    true,
    `the falling bullet to leave the roster within ${String(FALL_FRAMES)} ` +
      `frames, which is twice the fall from y ${String(START.y)} to ` +
      `FIELD_BOTTOM (${String(FIELD_BOTTOM)}) (specs/field.md)`,
  );
  assertLessThanOrEqual(
    FIELD_BOTTOM - lastAlive,
    LEAVE_MARGIN,
    `how far above FIELD_BOTTOM (${String(FIELD_BOTTOM)}) the bullet's centre ` +
      `still was on the last frame it was on the roster, allowing one frame of ` +
      `fall and the bullet's own ${String(ENEMY_BULLET_H / 2)}-unit drawn ` +
      `half-height (specs/field.md)`,
  );
});
