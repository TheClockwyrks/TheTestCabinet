// bands/shield-opposite-lethal — an opposite-band enemy bullet costs a life.
//
// specs/bands.md, "Your band is your shield", second row of its table: "The
// opposite band | The ship is hit, and the bullet leaves the roster", and
// specs/progression.md fixes the price at one — "An enemy bullet of the band
// opposite the ship's reaches the ship | One life", and "One event costs exactly
// one life, whatever else is on the field at that instant". So this point reads
// one number, the lives remaining, and requires EXACTLY one to have been paid: a
// build that charges two for one bullet fails here as surely as one that charges
// none.
//
// THE WORLD IS THE SHIP AND ONE FALLING BULLET, the posture `bands.shield-absorbs`
// poses, with `setShipContact(true)` the one world gate turned back on because the
// ship's contact test IS the faculty under test. The single variable between the
// two points is the band the bullet carries, so a failure here names the shield's
// direction: a build that absorbs everything fails this and passes that, and one
// that absorbs nothing fails that and passes this.
//
// LIVES ARE POSED WITH SPARE, so the contact reads as a decrement rather than as
// the end of the run, which is `progression.game-over-at-zero`'s point.
//
// WHAT THIS DOES NOT DECIDE. What losing a life does to the wave — the ready hold,
// the respawn — belongs to the `progression` points, and what the hit plays
// belongs to `audio.hit`. This point reads the lives and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  ENEMY_BULLET_SPEED,
  SHIP_HALF,
  SHIP_Y,
  START_LIVES,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The band the ship holds, and the opposite one the bullet carries. */
const SHIP_BAND = "cyan" as const;
const BULLET_BAND = "magenta" as const;

/** How far above the ship's centre the bullet is placed, in logical units. */
const DROP = 100;

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHIP_HALF + ENEMY_BULLET_HALF;

/**
 * How long the bullet is given to reach the hull, in frames of the 120 Hz clock.
 *
 * `0.35` s. At `ENEMY_BULLET_SPEED` (`320`) the contact is `DROP - TOUCHING`
 * (`77`) units away, which is `0.241` s, so the window runs 45% past it and a
 * build that integrates the fall a little differently still lands the contact
 * inside it.
 */
const DRIVE_TICKS = ticksFor(0.35);

/** Lives before the contact, and the one specs/progression.md leaves after it. */
const LIVES_BEFORE = START_LIVES;
const LIVES_AFTER = LIVES_BEFORE - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes exactly one life when a magenta bullet reaches a cyan ship", async () => {
  startPosed(h);
  h.debug.setShipContact(true);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setLives(LIVES_BEFORE);
  const posed = h.snapshot();
  assertEqual(
    posed.ship.band,
    SHIP_BAND,
    "the band the ship was posed on, which is what makes this reading about " +
      "a bullet of the band OPPOSITE the ship's",
  );
  assertEqual(
    posed.lives,
    LIVES_BEFORE,
    "the lives the run was posed with, which is the number the reading below " +
      "is measured against",
  );

  h.debug.addEnemyBullet(LANE_CENTER, SHIP_Y - DROP, BULLET_BAND);

  await h.advance(DRIVE_TICKS);
  captureStill(h, "hit");

  assertEqual(
    h.snapshot().lives,
    LIVES_AFTER,
    `lives after a ${BULLET_BAND} enemy bullet fell ${DROP} units at ` +
      `ENEMY_BULLET_SPEED ${ENEMY_BULLET_SPEED} into a ${SHIP_BAND} ship, ` +
      `from ${LIVES_BEFORE} over ${DRIVE_TICKS} frames ` +
      `(${seconds(DRIVE_TICKS)} s) — specs/bands.md: a bullet of the band ` +
      `opposite the ship's hits it once its centre is within ${TOUCHING} ` +
      `units of the ship's, and specs/progression.md prices that at one life. ` +
      `${LIVES_BEFORE} is a bullet the hull wrongly absorbed or never met; ` +
      `${LIVES_BEFORE - 2} is one charged twice`,
  );
});
