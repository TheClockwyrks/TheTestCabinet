// bands/shield-absorbs — a same-band enemy bullet is absorbed.
//
// specs/bands.md, "Your band is your shield": "When an enemy bullet contacts the
// ship, the enemy bullet's effective band against the ship's band decides the
// outcome", first row of its table — "The same band as the ship's | The bullet is
// absorbed and leaves the roster, and the ship is unharmed". Both halves of that
// row are read here, because both are what "absorbed" means: no life is paid, and
// the bullet is off the field. What an absorb ADDS to the meter is
// specs/resonance.md's and `resonance.absorb-fills`'s; nothing here reads it.
//
// THE WORLD IS THE SHIP AND ONE FALLING BULLET. `startPosed` empties the rosters
// and shuts the three world gates, and this scenario turns back the one gate that
// IS the faculty under test — `setShipContact(true)`, the ship's contact test.
// Wave entry and dive launching stay off, so no drone arrives to reach the ship
// on its own and no second contact can move the number this check reads.
//
// THE BULLET IS PLACED AND FALLS. `addEnemyBullet` puts one bullet in flight
// straight down at the stage's `ENEMY_BULLET_SPEED` (specs/instrumentation.md),
// so its whole path is fixed by the pose and nothing about a diver's aim or a
// drone's fire enters this reading.
//
// THE WINDOW IS BOUNDED AT BOTH ENDS, and both ends are load-bearing. It has to
// be long enough that the bullet has certainly reached the hull — {@link DROP}
// units less the {@link TOUCHING} its circles need to overlap — and short enough
// that a bullet the build let PASS THROUGH is still above `FIELD_BOTTOM`
// (specs/field.md), where the field would remove it and a pass-through would read
// as an absorb.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  SHIP_HALF,
  SHIP_Y,
  START_LIVES,
} from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  findBullet,
  lastBullet,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The band the ship holds, and the band the bullet carries: the same one. */
const SHIELDED_BAND = "cyan" as const;

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
 * inside it. It stops well short of the `0.49` s at which a bullet that passed
 * straight through would cross `FIELD_BOTTOM` (`656`) and be removed by the
 * field: at the end of this window such a bullet stands at y
 * `SHIP_Y - DROP + 112`, which is 44 units above that line and still on the
 * roster, so an empty roster means the hull took it.
 */
const DRIVE_TICKS = ticksFor(0.35);

/**
 * How far a bullet the build let pass through would still be from the edge that
 * removes it, in logical units.
 *
 * Positive is what makes an empty roster mean "the hull took it" rather than "the
 * field took it" (specs/field.md removes an enemy bullet whose centre falls below
 * `FIELD_BOTTOM`).
 */
const CLEARANCE =
  FIELD_BOTTOM - (SHIP_Y - DROP + ENEMY_BULLET_SPEED * seconds(DRIVE_TICKS));

/** Lives before the contact, so a life paid would be a decrement and visible. */
const LIVES_BEFORE = START_LIVES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no life and clears the roster when a cyan bullet reaches a cyan ship", async () => {
  startPosed(h);
  h.debug.setShipContact(true);
  h.debug.setShipBand(SHIELDED_BAND);
  h.debug.setLives(LIVES_BEFORE);
  const posed = h.snapshot();
  assertEqual(
    posed.ship.band,
    SHIELDED_BAND,
    "the band the ship was posed on, which is what makes this reading about " +
      "a bullet of the ship's OWN band",
  );
  assertEqual(
    posed.lives,
    LIVES_BEFORE,
    "the lives the run was posed with, which is the number the reading below " +
      "is measured against",
  );

  h.debug.addEnemyBullet(LANE_CENTER, SHIP_Y - DROP, SHIELDED_BAND);
  const bulletId = lastBullet(h.snapshot()).id;

  await h.advance(DRIVE_TICKS);
  captureStill(h, "absorbed");

  const after = h.snapshot();
  assertEqual(
    after.lives,
    LIVES_BEFORE,
    `lives after a ${SHIELDED_BAND} enemy bullet fell ${DROP} units into a ` +
      `${SHIELDED_BAND} ship over ${DRIVE_TICKS} frames ` +
      `(${seconds(DRIVE_TICKS)} s) — specs/bands.md: a bullet of the ship's ` +
      "own band is absorbed and the ship is unharmed",
  );
  assertNull(
    findBullet(after, bulletId),
    `the ${SHIELDED_BAND} bullet is gone from the roster, having closed to ` +
      `within ${TOUCHING} units of the ship's centre with ` +
      `${CLEARANCE} units still between a pass-through and FIELD_BOTTOM — ` +
      "specs/bands.md: an absorbed bullet leaves the roster",
  );
});
