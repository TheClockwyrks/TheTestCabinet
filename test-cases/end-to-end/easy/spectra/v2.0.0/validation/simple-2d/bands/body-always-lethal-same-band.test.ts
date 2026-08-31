// bands/body-always-lethal-same-band — a same-band drone body costs a life.
//
// specs/bands.md, "Your band is your shield": "A drone's body is not filtered by
// the shield. Contact between the ship and any drone's body, of either band and
// whatever the ship is tuned to, hits the ship", and specs/progression.md prices
// it — "Any drone's body reaches the ship, of either band | One life". The ship
// is posed on `cyan` and the body carries `cyan`, so a body is never mistaken for a shield.
//
// THE WORLD IS THE SHIP AND ONE DIVING SHARD. `startPosed` empties the rosters
// and shuts the three world gates, and this scenario turns back the one gate that
// IS the faculty under test — `setShipContact(true)`. Wave entry and dive
// launching stay off, so the body that arrives is the body this check put there
// and no second contact can move the number it reads.
//
// THE SHARD DIVES IN RATHER THAN BEING POSED ON THE HULL, so the reading is "a
// body that ARRIVED costs a life" and not "a body posed in contact costs one". It
// is posed in phase `diving`, which is the phase in which a body genuinely
// reaches the ship: a formation slot sits at y 140–332 (specs/field.md), so a
// formation drone in the ship's lane at y 600 is a state the game's own geometry
// never produces, and a build that scopes its body contact to drones that have
// left the formation would fail over a situation no player can reach.
//
// IT IS POSED WITH TRAVEL ALONE. Travel is the one faculty the requirement needs
// from the drone — it has to reach the ship — so the band clock and the firing
// stay off: a shot taken on the way down would be an enemy bullet reaching the
// ship, which is the shield's reading and a different point's.
//
// THE APPROACH IS SHORT AND STARTS ON THE SHIP'S OWN LANE POSITION. specs/swarm.md
// leaves a dive's exact path to the build — it bends toward the ship's `x` and
// may weave — so the further the drone falls before it arrives, the more of that
// unstated path this reading would be resting on. {@link APPROACH} is 60 units,
// of which only `APPROACH - TOUCHING` (31) has to be covered, which is a tenth
// of a second at `DIVE_SPEED`: a build weaving as widely as the specification
// allows cannot carry the body clear of the hull in that distance.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_SPEED,
  SHARD_HALF,
  SHIP_HALF,
  SHIP_Y,
  START_LIVES,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  distance,
  findDrone,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The band the ship holds, and the band the body carries. */
const SHIP_BAND = "cyan" as const;
const DRONE_BAND = "cyan" as const;

/** How far above the ship's centre the body starts, in logical units. */
const APPROACH = 60;

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHIP_HALF + SHARD_HALF;

/**
 * How long the body is given to arrive, in frames of the 120 Hz clock.
 *
 * `0.5` s. At `DIVE_SPEED` (`300`) the `APPROACH - TOUCHING` (`31`) units to
 * the contact take `0.103` s, so the window runs nearly five times past it and a
 * build whose dive is slower than the stated speed still arrives inside it.
 */
const DRIVE_TICKS = ticksFor(0.5);

/**
 * How close the body's centre gets to the ship's before the still is kept.
 *
 * Twice the overlap distance: the frame the body is bearing down on the hull and
 * about to reach it. Kept before the contact, because the life it costs takes the
 * ship off the field for the ready hold (specs/progression.md) and there is no
 * ship left to picture after.
 */
const CLOSING = 2 * TOUCHING;

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

it("takes one life when a cyan Shard's body reaches a cyan ship", async () => {
  startPosed(h);
  h.debug.setShipContact(true);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setLives(LIVES_BEFORE);
  const droneId = poseDrone(h, "shard", LANE_CENTER, SHIP_Y - APPROACH, {
    band: DRONE_BAND,
    phase: "diving",
    travel: true,
  });

  let captured = false;
  for (let frame = 0; frame < DRIVE_TICKS; frame += 1) {
    await h.advance(1);
    const field = h.snapshot();
    const body = findDrone(field, droneId);
    if (
      !captured &&
      body !== null &&
      distance(body, { x: field.ship.x, y: SHIP_Y }) <= CLOSING
    ) {
      captureStill(h, "hit");
      captured = true;
    }
    if (field.lives < LIVES_BEFORE) break;
  }

  assertEqual(
    h.snapshot().lives,
    LIVES_AFTER,
    `lives after a cyan Shard dived ${APPROACH} units at DIVE_SPEED ` +
      `${DIVE_SPEED} into a ${SHIP_BAND} ship, from ${LIVES_BEFORE} over up ` +
      `to ${DRIVE_TICKS} frames (${seconds(DRIVE_TICKS)} s) — ` +
      `specs/bands.md: a drone's body is not filtered by the shield, and ` +
      `contact within ${TOUCHING} units of the ship's centre hits it. ` +
      `${LIVES_BEFORE} is a body the hull wrongly shielded against or never ` +
      `met; ${LIVES_BEFORE - 2} is one charged twice`,
  );
});
