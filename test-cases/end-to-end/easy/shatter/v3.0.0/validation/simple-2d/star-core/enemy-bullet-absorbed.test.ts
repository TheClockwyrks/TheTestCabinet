// star-core/enemy-bullet-absorbed — the core absorbs a saucer's round too.
//
// `specs/collision.md` gives the saucer's round its own row against the core: "A
// saucer bullet and the core | The bullet is absorbed and removed." It is a
// separate row from the ship's round because it is a separate rule, and this is
// the item that decides it: a build that absorbs the player's shots at the core
// and lets the saucer's fly through fails here and nowhere else, and one that does
// the reverse fails `star-core/bullet-absorbed` and nowhere else.
//
// THE SCENARIO IS THE OTHER ITEM'S, WITH THE OTHER ROUND. One saucer round is
// placed a hundred units from the star's centre on the star's own row, travelling
// straight at it at `SAUCER_BULLET_SPEED`, on an empty and quiet field, and the
// roster is read once it has had time to arrive. Same geometry, so the two items
// differ in exactly the thing they grade.
//
// WHAT IT DOES NOT READ. Nothing about the score: `specs/collision.md` gives the
// saucer's round no scoring clause at all, and the score is
// `star-core/bullet-absorbed`'s reading. Nothing about the ship either — the ship
// stands at its safe point below the star (`specs/ship.md`), the round crosses the
// star's row travelling away from it, and `startPlaying` has the ship's lethal
// contact test off, so `specs/collision.md`'s saucer-bullet-and-ship row cannot
// reach into this reading.
//
// WHY THE WINDOW IS FOUR TENTHS OF A SECOND. `specs/saucer.md` gives the round a
// `SAUCER_BULLET_LIFE` of `1.4` seconds and `SAUCER_BULLET_SPEED` of `300`, so the
// sixty-seven units between the round's leading edge and the core's surface are
// covered in under a quarter of a second while a full second of life is still
// left. A build that absorbs nothing still holds its round at the reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  CORE_R,
  SAUCER_BULLET_R,
  SAUCER_BULLET_SPEED,
  STAR_X,
  STAR_Y,
} from "../../src/constants";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseEnemyBullet,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import type { Point } from "../geometry";

/** How far from the star's centre the round is placed, in units. */
const RANGE = 100;

/** Where that puts it: on the star's row, to its left. */
const START: Point = { x: STAR_X - RANGE, y: STAR_Y };

/** The gap the round must close before its circle reaches the core's surface. */
const REACH = RANGE - (CORE_R + SAUCER_BULLET_R);

/**
 * How long the round is followed: four tenths of a second.
 *
 * Nearly twice the time it needs to cross {@link REACH} at `SAUCER_BULLET_SPEED`
 * — and `specs/gravity.md` pulls a saucer bullet as well, along the travel here,
 * so it only arrives sooner — and well short of the `1.4` seconds
 * `specs/saucer.md` gives it to live.
 */
const FLIGHT_TICKS = ticksFor(0.4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a saucer round driven into the core off the field", async () => {
  startPlaying(h);
  poseEnemyBullet(h, START.x, START.y, SAUCER_BULLET_SPEED, 0);

  await h.advance(FLIGHT_TICKS);
  captureStill(h, "absorbed");

  assertLength(
    h.snapshot().enemyBullets,
    0,
    `the saucer bullets in flight ${secondsFor(FLIGHT_TICKS).toFixed(2)} ` +
      `seconds after one was placed ${REACH} units short of the core's ` +
      "surface and sent at it (specs/collision.md: a saucer bullet and the " +
      "core, the bullet is absorbed and removed)",
  );
});
