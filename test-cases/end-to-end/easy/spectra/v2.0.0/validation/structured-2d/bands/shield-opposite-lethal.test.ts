// bands/shield-opposite-lethal — an enemy bullet of the opposite band costs a life.
//
// specs/bands.md, second row of the shield table: "The opposite band | The ship is
// hit, and the bullet leaves the roster", and specs/progression.md prices it —
// "An enemy bullet of the band opposite the ship's reaches the ship | One life",
// with "One event costs exactly one life, whatever else is on the field at that
// instant."
//
// THE SCENARIO IS `bands.shield-absorbs` WITH ONE VALUE CHANGED — the bullet's
// band — so the two points together decide whether the hull filters or merely
// waves everything through. The ship is on `cyan`, the bullet is `magenta`, the
// ship's contact test is turned back on because it is this point's requirement,
// and nothing else is on the field, so the life count can only move for the
// reason under test.
//
// THE READING IS THE LIFE COUNT AND NOTHING ELSE: EXACTLY one life, so a build
// that charges the hit twice fails as loudly as one that charges it not at all.
// Whether the bullet also leaves the roster is the sibling's direction, and a
// build that charges the hit correctly while keeping its bullet should not fail
// the hit.

import { afterEach, beforeEach, it } from "vitest";
import { ENEMY_BULLET_HALF, SHIP_HALF, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAtShip,
  startPosed,
  type Harness,
} from "../harness";

/** The band the ship holds, which `startPosed` poses. */
const SHIP_BAND = "cyan" as const;

/** The band the bullet carries: the opposite one. */
const SHOT_BAND = "magenta" as const;

/** The contact reach: `SHIP_HALF` (`15`) + `ENEMY_BULLET_HALF` (`8`). */
const TOUCHING = SHIP_HALF + ENEMY_BULLET_HALF;

/** How far above the ship's lane the bullet starts: five times the reach. */
const DROP_ABOVE = 5 * TOUCHING;

/**
 * Frames the fall is allowed.
 *
 * At `ENEMY_BULLET_SPEED` (`320`) times `bulletSpeedScale(1)` (`1`) the bullet
 * covers 3.2 units per frame of the harness's 100 Hz clock and enters the hull's
 * reach after 92 units, inside 29 frames; forty-five leaves the contact sixteen
 * frames of slack to resolve in, and stops the sweep long before `READY_HOLD`
 * (`1.3` s, specs/progression.md) could end and expose the ship to a second
 * charge.
 */
const FALL_TICKS = 45;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs exactly one life when the opposite-band bullet reaches the hull", async () => {
  startPosed(h);
  h.debug.setShipContact(true);

  const posed = h.snapshot();
  assertEqual(posed.ship.band, SHIP_BAND, "the band the ship was posed on");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  await fireAtShip(h, SHOT_BAND, DROP_ABOVE, FALL_TICKS);
  captureStill(h, "hit");

  assertEqual(
    h.snapshot().lives,
    START_LIVES - 1,
    `the lives left after one ${SHOT_BAND} bullet fell ${DROP_ABOVE} units ` +
      `into the hull's ${TOUCHING}-unit contact reach while the ship held ` +
      `${SHIP_BAND} (specs/bands.md, specs/progression.md)`,
  );
});
