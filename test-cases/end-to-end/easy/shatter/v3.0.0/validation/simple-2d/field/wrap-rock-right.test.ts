// field/wrap-rock-right — a rock driven off the right edge re-enters at the
// left one, its centre wrapping modulo the field size.
//
// ONE SEAM, ONE POINT. Each edge a rock crosses is an item of its own, because
// each is a separate branch in practically every build: `if (x > FIELD_W) x -=
// FIELD_W` with no `x < 0` branch wraps off one edge and not the mirror of it.
// A build that wraps off the right edge and not the left one has to grade
// differently from one that wraps off neither, and a single verdict taken over
// every seam at once cannot say which edge broke. So this check reads the
// right edge and nothing else; its siblings `field/wrap-rock-left`,
// `field/wrap-rock-top` and `field/wrap-rock-bottom` read the others.
//
// THE RULE. `specs/field.md` makes the field a torus with no outer walls and
// keeps a coordinate in range by taking it modulo the field size on that axis:
// "the wrap applies to every body on the field". `specs/rocks.md` says it again
// for a rock, which drifts under momentum, is curved by the well, and wraps at
// the field's edges. This item decides the wrap for that body alone, so a build
// that wraps its ship and forgets its rocks loses exactly this point.
//
// WHAT IS READ. The pair of ticks the wrap lies between (see `seams.ts`): the
// tick's own motion says how far past the seam the rock went and the rule says
// where that lands. A build that snaps the coordinate to the far edge, one that
// reflects it, one that re-enters a radius late and one that removes the rock at
// the boundary each read as a different number.
//
// WHY THE CROSSINGS ARE FLOWN ON THE STAR'S OWN ROW AND COLUMN. A wrap moves a
// coordinate the whole width of the field in one step, so a build that resolves
// the core against the SEGMENT between two consecutive positions — which
// `specs/collision.md` demands, requiring a swept test and forbidding a body
// passing through another in a tick — sees a line straight across the field on
// the tick the rock crosses the seam, unless it is written to understand the
// seam. On the star's row that false line runs through the core and the rock is
// recycled: `specs/collision.md` sends a rock that reaches the core back in from
// a random edge, so the reading lands somewhere the rule never put it. Off the
// row the false line misses the core and the fault is invisible. A conformant
// build is untouched — the shortest wrapped separation from the seam to the
// star's centre is 640 units across its row and 360 down its column, against
// the `CORE_R + ROCK_RADIUS.small` (`44`) at which a Small is taken.
//
// WHY A SMALL AT THIS SPEED. `addRock` places a rock AT REST and
// `setRockVelocity` gives it the course, which is what `poseRock` does with both.
// A Small at `200` units per second is inside the `130`–`210` band
// `specs/rocks.md` fixes for its size, so the pose is a drift the game itself
// hands out, and it is the fastest of the three sizes, which makes the half-tick
// overshoot the crossing is posed with as large as a legitimate drift allows.

import { afterEach, beforeEach, it } from "vitest";
import { STAR_Y } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
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
 * The drift the rock is flown at, in units per second.
 *
 * Inside `ROCK_SPEED_MIN.small`–`ROCK_SPEED_MAX.small` (`130`–`210`), the band
 * `specs/rocks.md` fixes for a Small's base drift, so nothing about the pose is a
 * speed the game would not itself produce.
 */
const CROSS_SPEED = 200;

/** The run-up driven before the crossing: a tenth of a second of approach. */
const APPROACH_TICKS = ticksFor(0.1);

/**
 * How far the wrapped centre may sit from where the modulus puts it, in units.
 *
 * The rule is arithmetic and the reading is taken one tick after the position and
 * velocity it is predicted from, so the only thing a conformant build can be off
 * by over that tick is the well's own contribution to the tick's displacement.
 * The binding crossing is the one down the star's own COLUMN, whose seam stands
 * 360 units from the star: `specs/gravity.md` gives `MU / 360^2` = 34.7 units per
 * second squared there, and one tick of that displaces the body by
 * `34.7 * TICK_DT^2`, 2.4 thousandths of a unit. (Across the star's row the seam
 * is 640 units out, where the same law gives 11 and the displacement is 8
 * ten-thousandths.)
 *
 * This bound is eighty times that. It is also under a quarter of the 0.83 units
 * of overshoot the pose builds in — the gap a build that snaps the coordinate to
 * the edge misses by, which the well's own drag on the rock along the crossing
 * narrows to 0.60 at the tightest of the four — and a seventieth of
 * `ROCK_RADIUS.small` (`14`), so a build that wraps on the rock's edge rather
 * than its centre fails.
 */
const WRAP_TOLERANCE = 0.2;

/** The one crossing this item decides: off the right edge, round to the left one. */
const CROSSING: { seam: Seam; to: Seam; line: number } = {
  seam: "right",
  to: "left",
  line: STAR_Y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps a rock leaving the right edge round to the left edge", async () => {
  const { seam, line } = CROSSING;

  startPlaying(h);

  const run = approachTo(seam, CROSS_SPEED, APPROACH_TICKS);
  const pose = posedAt(run, line);
  const id = poseRock(h, "small", pose.x, pose.y, pose.vx, pose.vy);

  const crossing = await crossSeam(
    h,
    run,
    (snapshot) => snapshot.rocks.find((rock) => rock.id === id),
    APPROACH_TICKS,
    `rock leaving the ${seam} edge`,
  );
  captureStill(h, "wrap");

  const across = otherAxis(run.axis);
  assertLessThanOrEqual(
    Math.abs(coordinateOn(crossing.after, run.axis) - crossing.expected),
    WRAP_TOLERANCE,
    `the rock's centre ${run.axis} one tick after leaving the ${seam} edge, ` +
      `which the tick's own motion carried to ${crossing.unwrapped.toFixed(3)}`,
  );
  assertLessThanOrEqual(
    Math.abs(
      coordinateOn(crossing.after, across) -
        coordinateOn(crossing.before, across),
    ),
    WRAP_TOLERANCE,
    `the rock's centre ${across}, which the crossing leaves alone`,
  );
});
