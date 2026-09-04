// field/wrap-ship-top — a ship driven off the top edge re-enters at the
// bottom one, its centre wrapping modulo the field size.
//
// ONE SEAM, ONE POINT. Each edge a ship crosses is an item of its own, because
// each is a separate branch in practically every build: `if (y > FIELD_H) y -=
// FIELD_H` with no `y < 0` branch wraps off one edge and not the mirror of it.
// A build that wraps off the top edge and not the bottom one has to grade
// differently from one that wraps off neither, and a single verdict taken over
// every seam at once cannot say which edge broke. So this check reads the top
// edge and nothing else; its siblings `field/wrap-ship-right`,
// `field/wrap-ship-left` and `field/wrap-ship-bottom` read the others.
//
// THE RULE. `specs/field.md` makes the field a torus with no outer walls: a
// coordinate is kept in range by taking it modulo the field size on that axis, a
// body leaving the right edge re-enters at the left, and "the wrap applies to
// every body on the field". `specs/ship.md` says it again for the ship in so many
// words. This item decides one seam for the ship alone; every other body carries
// items of its own, so a build that wraps the ship and forgets the enemy
// bullet loses exactly those points.
//
// WHAT IS READ, AND WHY THAT AND NOT A POSITION. The pair of ticks the wrap lies
// between (see `seams.ts`). The tick before the crossing says where the ship
// stood and how fast it was going, so the tick's own motion says exactly how far
// past the seam it went, and the rule says exactly where that lands. A build that
// snaps the coordinate to the far edge, one that reflects it, one that re-enters
// a ship's radius late and one that deletes the ship at the boundary each read as
// a different number, so a failure says which of them the build implemented.
//
// WHY THE CROSSINGS ARE FLOWN ON THE STAR'S OWN ROW AND COLUMN. Because that is
// where the one wrap fault a build reaches by trying hard shows itself. A wrap
// moves a coordinate the whole width of the field in a single step, so a build
// that tests the core against the SEGMENT between two consecutive positions —
// which `specs/collision.md` demands, since it requires a swept test and forbids
// a body passing through another in a tick — sees a line straight across the
// field on the tick the ship crosses the seam, unless it is written to understand
// the seam. On the star's row that false line runs through the core, and the ship
// is pushed off it by the slide `specs/collision.md` states. Off the row it
// misses, and the fault is invisible. A conformant build is not touched: the
// shortest wrapped separation from the seam to the star's centre is 640 units
// across its row and 360 down its column, against the 44 at which the slide
// begins.
//
// WHY THE SHIP IS POSED WITH A VELOCITY. "Driven off each of the four edges" is
// about the wrap, not about the thrust: `setShipVelocity` is the one operation
// the requirement needs, and how a player builds that velocity is the `controls`
// and `flight` items. `startPlaying` has emptied the field, shut both world gates
// and shut the ship's lethal contact test, so the crossing is the only thing
// happening.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { STAR_X } from "../constants";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  approachTo,
  coordinateOn,
  crossSeam,
  otherAxis,
  posedAt,
  type Seam,
} from "./seams";

/**
 * The speed the ship is flown at, in units per second.
 *
 * Under `SHIP_MAX` (`680`), the cap `specs/ship.md` sets, so the pose is a state
 * a player can reach. Fast enough that one tick covers five units, which is what
 * makes the half-tick overshoot the crossing is posed with a figure no wrong wrap
 * model reads by accident.
 */
const CROSS_SPEED = 600;

/** The run-up filmed before the crossing: a tenth of a second of approach. */
const APPROACH_TICKS = ticksFor(0.1);

/** More of the flight past the seam, filmed after the reading, for the replay. */
const DWELL_TICKS = ticksFor(0.375);

/**
 * How far the wrapped centre may sit from where the modulus puts it, in units.
 *
 * The rule is arithmetic, so a conformant build has almost nothing to be off by.
 * The reading is taken one tick after the position and velocity it is predicted
 * from, and over that tick the only thing that touches the ship is its drag: at
 * `SHIP_DRAG_HALFLIFE` (`3.0` s) one tick multiplies the velocity by
 * `0.5 ^ (TICK_DT / 3)`, taking 0.23 percent off that tick's travel — a
 * hundredth of a unit at this speed. The well never pulls the ship at all
 * (`specs/gravity.md`), and a build that drags AFTER it moves is off by nothing.
 *
 * So this bound is thirty times the largest deviation a correct build can have,
 * and still a fifth of the gap it has to open up. That gap is the overshoot the
 * pose builds in: half a tick's travel is 2.5 units, and the same drag bleeds the
 * approach down to a real 1.6 by the crossing — which is what a build that snaps
 * the coordinate to the edge instead of carrying the overshoot across misses by.
 * It is also far under `SHIP_R` (`14`), so a build that wraps on the ship's edge
 * rather than its centre fails.
 */
const WRAP_TOLERANCE = 0.3;

/** The one crossing this item decides: off the top edge, round to the bottom one. */
const CROSSING: { seam: Seam; to: Seam; line: number } = {
  seam: "top",
  to: "bottom",
  line: STAR_X,
};

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("wraps a ship leaving the top edge round to the bottom edge", async () => {
  const { seam, line } = CROSSING;

  await startPlaying(harness);

  const run = approachTo(seam, CROSS_SPEED, APPROACH_TICKS);
  const pose = posedAt(run, line);
  await harness.debug.setShipPosition(pose.x, pose.y);
  await harness.debug.setShipVelocity(pose.vx, pose.vy);

  const fly = async () => {
    const flown = await crossSeam(
      harness,
      run,
      (snapshot) => snapshot.ship,
      APPROACH_TICKS,
      `ship leaving the ${seam} edge`,
    );
    await harness.advance(DWELL_TICKS);
    return flown;
  };
  const crossing = await captureReplay(harness, "wrap", fly);

  const across = otherAxis(run.axis);
  assertLessThanOrEqual(
    Math.abs(coordinateOn(crossing.after, run.axis) - crossing.expected),
    WRAP_TOLERANCE,
    `the ship's centre ${run.axis} one tick after leaving the ${seam} edge, which the tick's own motion carried to ${crossing.unwrapped.toFixed(3)}`,
  );
  assertLessThanOrEqual(
    Math.abs(
      coordinateOn(crossing.after, across) -
        coordinateOn(crossing.before, across),
    ),
    WRAP_TOLERANCE,
    `the ship's centre ${across}, which the crossing leaves alone`,
  );
});
