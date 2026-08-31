// Meltdown — combat/range-outside: a unit past the radius is not targeted.
//
// specs/combat.md closes the range rule with the other side of the boundary: "A
// unit one logical unit further out is not in range." specs/towers.md gives the
// Arc `6.0` tiles and specs/floor.md gives `TILE` `19`, so `114` units is in and
// `115` is out, and this point poses the mark at `115`.
//
// ONE UNIT OUT RATHER THAN A COMFORTABLE MILE, BECAUSE THAT IS THE FIGURE THE
// SPECIFICATION FIXES. A mark parked far away would pass on a build whose radius
// is half the floor. Posed one unit past the edge, the point fails any build that
// rounds the radius up to a whole tile, adds a fudge to it, measures in squared
// units against an unsquared bound, or reads the comparison the wrong way round.
// `combat/range-inside` holds the inclusive side, so the pair pins the radius to a
// single logical unit.
//
// TWO READINGS OF THE SAME REFUSAL, both in the same direction: the emitter
// reports no target, and the mark's hp is untouched after a full second — two fire
// intervals at the Arc's `2.0` a second. The second is what catches a build that
// reports `targeting` null while shooting anyway.
//
// DUE EAST, so the distance is one exact subtraction; and the mark's motion is off,
// so it cannot drift into range while the second is spent.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { poseGun, poseMarkEast, rangeUnitsOf, readGun, readHp } from "./duel";

/** The emitter read, and the heat it is pinned at. */
const TOWER = "arc";
const HEAT = 0;

/** specs/combat.md: one logical unit past `range * TILE` is not in range. */
const RADIUS_UNITS = rangeUnitsOf(TOWER);
const OUTSIDE_UNITS = RADIUS_UNITS + 1;

/** How long the refusal is held for, in seconds of game time. */
const WATCH_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A unit outside the radius is not", async () => {
  const gunId = poseGun(h, TOWER, HEAT);
  const mark = poseMarkEast(h, TOWER, "mote", OUTSIDE_UNITS);
  const opened = readHp(h, mark);

  await h.advance(ticksFor(WATCH_SECONDS));
  captureStill(h, "outside");
  const gun = readGun(h, gunId);

  assertNull(
    gun.targeting,
    `targeting with one mark ${OUTSIDE_UNITS} units from the footprint centre, ` +
      `one unit past the ${TOWER}'s ${RADIUS_UNITS}`,
  );
  assertEqual(
    gun.firing,
    false,
    `firing with nothing inside the ${TOWER}'s ${RADIUS_UNITS}`,
  );
  assertEqual(
    opened - readHp(h, mark),
    0,
    `hp removed from a mark one unit past the radius over ${WATCH_SECONDS}s`,
  );
});
