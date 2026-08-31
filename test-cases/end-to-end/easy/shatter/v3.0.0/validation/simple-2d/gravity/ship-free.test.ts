// gravity/ship-free — the well never pulls the ship.
//
// `specs/gravity.md` names the ship in its table of bodies as NOT pulled, and
// says why in a sentence: "The ship and the saucer are powered craft with their
// own drive. The well never adds anything to their velocity, whatever their
// distance from the star, so each holds exactly the course it is steering." This
// item is the ship half of that; `gravity/saucer-free` is the saucer half, so a
// build that exempted one craft and not the other fails exactly one of the two.
//
// THE SCENARIO IS THE ITEM'S OWN. The ship is posed at rest 120 units from the
// star's centre, with no key held, and two seconds of game time are run. Under
// the specification nothing whatever moves it: `specs/ship.md` gives an
// un-thrusting ship drag alone, and drag on a velocity of zero is zero. Under a
// build that pulled it, 120 units is where `specs/gravity.md` tabulates the pull
// at 312.5, so two seconds would hand it 625 units per second and carry it into
// the core. There is no third answer for a tolerance to sit between.
//
// WHY 120 AND NOT FURTHER OUT. It is the item's stated distance, and it is the
// nearest of `gravity/pull-magnitude`'s three samples: close enough that a build
// leaking even a hundredth of the stated pull into the ship moves it six units
// and fails, and still far outside `CORE_R + SHIP_R` (44), so the slide
// `specs/collision.md` defines is nowhere near being provoked. The ship is posed
// straight up the field from the star, so a build that DID pull it would move the
// ship along one axis and be unmistakable in the still.
//
// WHAT IS TOUCHED AND WHAT IS NOT. `startPlaying` leaves an empty, quiet, live
// field with the ship's lethal contact test off, so there is nothing on the field
// to reach the ship and nothing the ship could reach; the only things this check
// then changes are where the ship stands and that it is at rest. No key is held,
// so `specs/ship.md`'s thrust and turn never run, and the facing `startPlaying`
// gave it is left alone — this item reads the ship's CENTRE and its SPEED, and
// says nothing about which way it points.

import { afterEach, beforeEach, it } from "vitest";
import { STAR_X, STAR_Y } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  speedOf,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { distance } from "../geometry";
import type { Point } from "./law";

/** How far from the star the ship is posed, as the review item states. */
const STATION_DISTANCE = 120;

/** Where that puts it: straight up the field from the star's centre. */
const STATION: Point = { x: STAR_X, y: STAR_Y - STATION_DISTANCE };

/** The seconds of game time the station is held for, as the review item states. */
const HOLD_SECONDS = 2;

/**
 * How far the ship's centre may have moved: half a unit.
 *
 * The specification's answer is exactly zero, so this is rounding room rather
 * than an allowance. A build leaking one percent of the tabulated pull at this
 * distance moves the ship six units over the two seconds, which this catches
 * twelve times over.
 */
const DRIFT_TOLERANCE = 0.5;

/** How fast it may be going at the end, on the same terms: zero, plus room. */
const SPEED_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a ship at rest beside the star at rest, two seconds on", async () => {
  startPlaying(h);
  h.debug.setShipPosition(STATION.x, STATION.y);
  h.debug.setShipVelocity(0, 0);

  await h.advance(ticksFor(HOLD_SECONDS));
  captureStill(h, "free");

  const { ship } = h.snapshot();
  assertLessThanOrEqual(
    distance({ x: ship.x, y: ship.y }, STATION),
    DRIFT_TOLERANCE,
    `units the ship's centre moved from ${STATION_DISTANCE} out over ` +
      `${HOLD_SECONDS} seconds (specs/gravity.md: the well never pulls the ship)`,
  );
  assertLessThanOrEqual(
    speedOf(ship),
    SPEED_TOLERANCE,
    `the speed the ship holds after those ${HOLD_SECONDS} seconds`,
  );
});
