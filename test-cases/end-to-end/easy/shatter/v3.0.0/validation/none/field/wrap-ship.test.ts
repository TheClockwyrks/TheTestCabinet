// field/wrap-ship — the ship driven off each of the four edges re-enters at the
// opposite one, its centre wrapping modulo the field size.
//
// THE RULE. `specs/field.md` makes the field a torus with no outer walls: a
// coordinate is kept in range by taking it modulo the field size on that axis, a
// body leaving the right edge re-enters at the left, and "the wrap applies to
// every body on the field". `specs/ship.md` says it again for the ship in so many
// words. This item decides it for the ship alone; the four other bodies are four
// other items, so a build that wraps the ship and forgets the enemy bullet loses
// exactly one point.
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
// shortest wrapped separation from the seam to the star's centre is 637 units,
// against the 44 at which the slide begins.
//
// WHY THE SHIP IS POSED WITH A VELOCITY. "Driven off each of the four edges" is
// about the wrap, not about the thrust: `setShipVelocity` is the one operation
// the requirement needs, and how a player builds that velocity is the `controls`
// and `flight` items. `startPlaying` has emptied the field, shut both world gates
// and shut the ship's lethal contact test, so the crossing is the only thing
// happening.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { STAR_X, STAR_Y } from "../constants";
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
 * The rule is arithmetic, so a conformant build has almost nothing to be off by:
 * the reading is taken one tick after the position and velocity it is predicted
 * from, and over that tick the only thing that touches the ship is its drag,
 * which removes 0.19 percent of a tick's travel — a hundredth of a unit at this
 * speed. The well never pulls the ship at all (`specs/gravity.md`). So this bound
 * is sixty times the largest deviation a correct build can have, and still an
 * eighth of the 2.5 units of overshoot the pose builds in, which is what a build
 * that snaps the coordinate to the edge instead of carrying the overshoot across
 * misses by. It is also far under `SHIP_R` (`14`), so a build that wraps on the
 * ship's edge rather than its centre fails.
 */
const WRAP_TOLERANCE = 0.6;

/** The crossing whose drive is kept as the item's replay. */
const RECORDED: Seam = "right";

/**
 * The four crossings, each flown along the star's own row or column.
 *
 * `line` is the coordinate on the axis the crossing does NOT run along, so a
 * horizontal crossing is flown at the star's row and a vertical one at its
 * column.
 */
const CROSSINGS: readonly { seam: Seam; to: Seam; line: number }[] = [
  { seam: "right", to: "left", line: STAR_Y },
  { seam: "left", to: "right", line: STAR_Y },
  { seam: "bottom", to: "top", line: STAR_X },
  { seam: "top", to: "bottom", line: STAR_X },
];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it.each(CROSSINGS)(
  "wraps a ship leaving the $seam edge round to the $to edge",
  async ({ seam, line }) => {
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
    const crossing =
      seam === RECORDED
        ? await captureReplay(harness, "wrap", fly)
        : await fly();

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
  },
);
