// swarm/enemy-bullet-speed — enemy fire falls at ENEMY_BULLET_SPEED.
//
// specs/swarm.md, "Enemy fire": "An enemy bullet travels straight down at
// `ENEMY_BULLET_SPEED` (`320`) units per second, multiplied by
// `bulletSpeedScale(stage)`", which is `1` at the stage this poses.
//
// WHY THE BULLET IS PLACED RATHER THAN FIRED. `specs/instrumentation.md` gives
// `addEnemyBullet` a bullet "travelling straight down at `ENEMY_BULLET_SPEED`
// scaled for the current stage", which is exactly the thing under test and
// nothing else: no diver has to be posed, no fire line has to be crossed, and no
// kind's shot count is in the way. WHERE a shot comes from is
// `swarm/dive-fire-point`'s and what band it carries is
// `swarm/enemy-bullet-band`'s.
//
// The fall is read over a whole second, which is the figure the item names, from
// a bullet placed high enough in the field to still be in flight at the end of
// it: sixty units under `FIELD_TOP` it falls to about 444, well above the
// `FIELD_BOTTOM` (656) a bullet is removed at (`specs/field.md`).
//
// `startPosed` empties the field and shuts the ship's contact test, so nothing
// the bullet passes can absorb it and reaching the ship's lane costs nothing. The
// reading is the bullet's centre, as every position the surface reports is.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_SPEED,
  FIELD_TOP,
  FORM_CENTER_X,
  bulletSpeedScale,
} from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseEnemyBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { requireBullet } from "./roster";

/** The stage the bullet is placed at: the first, where bulletSpeedScale is 1. */
const STAGE = 1;

/** The fall the specification fixes for a second at that stage, in units. */
const EXPECTED = ENEMY_BULLET_SPEED * bulletSpeedScale(STAGE);

/** How far the reading may sit from it: the item's own 5%. */
const FALL_TOLERANCE = EXPECTED * 0.05;

/** The seconds of fall the item reads. */
const MEASURE = 1;

/** Where the bullet is placed: on the grid's centre line, high in the field. */
const AT = { x: FORM_CENTER_X, y: FIELD_TOP + 60 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops an enemy bullet ENEMY_BULLET_SPEED units in a second", async () => {
  startPosed(h);
  const id = poseEnemyBullet(h, AT.x, AT.y, "cyan");
  const from = requireBullet(
    h.snapshot(),
    id,
    "the enemy bullet the reading follows",
  );

  await h.advance(ticksFor(MEASURE));
  const to = requireBullet(
    h.snapshot(),
    id,
    "the enemy bullet after a second of fall",
  );
  captureStill(h, "fall");

  assertLessThanOrEqual(
    Math.abs(to.y - from.y - EXPECTED),
    FALL_TOLERANCE,
    `how far the ground the enemy bullet's centre fell in ${MEASURE}s ` +
      `(${(to.y - from.y).toFixed(1)} units, from y ${from.y.toFixed(1)} to ` +
      `${to.y.toFixed(1)}) sat from ENEMY_BULLET_SPEED * ` +
      `bulletSpeedScale(${STAGE}) (${EXPECTED}) (specs/swarm.md)`,
  );
});
