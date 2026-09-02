// bands/shield-absorbs — the hull absorbs an enemy bullet of the ship's own band.
//
// specs/bands.md makes the ship's current band its hull's shield, and the first
// row of its shield table fixes the outcome: "The same band as the ship's | The
// bullet is absorbed and leaves the roster, and the ship is unharmed".
// specs/progression.md prices the same event from the other side — "An enemy
// bullet of the ship's own band reaches the ship | Nothing, and it is absorbed".
//
// THE WORLD IS THE SHIP AND ONE BULLET. `startPosed` empties the three rosters,
// shuts the three world gates and leaves the ship on `cyan` at the centre of its
// lane. Exactly one gate is turned back on — the ship's contact test — because
// that gate IS this point's requirement: with it off no contact costs anything
// and the check would decide nothing. Nothing else is on the field, so the life
// count can only move for the contact under test.
//
// BOTH HALVES THE ROW STATES ARE READ, since they are one requirement in one
// direction: the bullet is absorbed, which is to say no life is paid AND the
// bullet leaves the roster. The opposite band is the sibling
// `bands.shield-opposite-lethal`, so a hull that absorbs everything and a hull
// that absorbs nothing grade differently.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  SHIP_HALF,
  START_LIVES,
  bulletSpeedScale,
} from "../constants";
import { assertEqual, assertUndefined } from "../assert";
import {
  SHIP_LANE_Y,
  bulletById,
  captureStill,
  createHarness,
  fireAtShip,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** The band the ship holds, which `startPosed` poses, and the bullet's with it. */
const SHIELDED_BAND = "cyan" as const;

/**
 * How close two centres come for the circles to overlap, in logical units.
 *
 * specs/simulation.md: an overlap of two circles of the half-extents their own
 * specs state — `SHIP_HALF` (`15`, specs/ship.md) and `ENEMY_BULLET_HALF` (`8`,
 * specs/swarm.md).
 */
const TOUCHING = SHIP_HALF + ENEMY_BULLET_HALF;

/**
 * How far above the ship's lane the enemy bullet starts, in logical units.
 *
 * Five times the contact reach, so the bullet is well clear of the hull when it is
 * placed and the contact the check reads is one the FALL produced.
 */
const DROP_ABOVE = 5 * TOUCHING;

/**
 * Frames the fall is allowed.
 *
 * An enemy bullet falls at `ENEMY_BULLET_SPEED` (`320`, specs/swarm.md) times
 * `bulletSpeedScale(1)` (`1`, specs/stages.md) — 3.2 units per frame of the
 * harness's 100 Hz clock — so it enters the hull's reach after
 * `DROP_ABOVE - TOUCHING` = 92 units, inside 29 frames. Forty-five leaves sixteen
 * frames of slack for whichever sub-step a build resolves the contact on, and
 * still ends {@link CLEARANCE} units above `FIELD_BOTTOM`: inside this sweep a
 * bullet cannot leave the roster by falling off the field, so leaving it means the
 * hull took it.
 */
const FALL_TICKS = 45;

/**
 * How far a bullet that fell straight past the ship would still be from the edge
 * that removes it, in logical units (specs/field.md: an enemy bullet whose centre
 * falls below `FIELD_BOTTOM` is removed).
 */
const CLEARANCE =
  FIELD_BOTTOM -
  (SHIP_LANE_Y -
    DROP_ABOVE +
    seconds(FALL_TICKS) * ENEMY_BULLET_SPEED * bulletSpeedScale(1));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life and takes the same-band bullet off the roster", async () => {
  startPosed(h);
  h.debug.setShipContact(true);

  const posed = h.snapshot();
  assertEqual(posed.ship.band, SHIELDED_BAND, "the band the ship was posed on");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  const bulletId = await fireAtShip(h, SHIELDED_BAND, DROP_ABOVE, FALL_TICKS);
  captureStill(h, "absorbed");

  const after = h.snapshot();
  assertEqual(
    after.lives,
    START_LIVES,
    `the lives left after one ${SHIELDED_BAND} bullet fell ${DROP_ABOVE} units ` +
      `into the hull's ${TOUCHING}-unit contact reach while the ship held ` +
      `${SHIELDED_BAND} (specs/bands.md, specs/progression.md)`,
  );
  assertUndefined(
    bulletById(after, bulletId),
    `the same-band bullet gone from the roster, absorbed by the hull with ` +
      `${CLEARANCE} units still between it and FIELD_BOTTOM (specs/bands.md)`,
  );
});
