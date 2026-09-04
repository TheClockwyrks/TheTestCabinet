// field/wrap-bullet-top — a bullet driven off the top edge re-enters at the
// bottom one, its centre wrapping modulo the field size.
//
// ONE SEAM, ONE POINT. Each edge a bullet crosses is an item of its own,
// because each is a separate branch in practically every build: `if (y >
// FIELD_H) y -= FIELD_H` with no `y < 0` branch wraps off one edge and not the
// mirror of it. A build that wraps off the top edge and not the bottom one has
// to grade differently from one that wraps off neither, and a single verdict
// taken over every seam at once cannot say which edge broke. So this check
// reads the top edge and nothing else; its siblings `field/wrap-bullet-right`,
// `field/wrap-bullet-left` and `field/wrap-bullet-bottom` read the others.
//
// THE RULE. `specs/field.md` makes the field a torus with no outer walls, and
// keeps a coordinate in range by taking it modulo the field size on that axis:
// "the wrap applies to every body on the field". `specs/weapons.md` says it again
// for the gun's round — a bullet "is pulled by the well, wraps at the edges, and
// is removed when it is spent" — so leaving an edge is not what removes one. This
// item decides the wrap for that body alone.
//
// WHAT IS READ. The pair of ticks the wrap lies between (see `seams.ts`): the
// tick's own motion says how far past the seam the round went and the rule says
// where that lands. A build that snaps the coordinate to the far edge, one that
// reflects it, one that re-enters a radius late, and one that treats the edge as
// the end of the round's life each read as a different number.
//
// WHY THE CROSSINGS ARE FLOWN ON THE STAR'S OWN ROW AND COLUMN. A wrap moves a
// coordinate the whole width of the field in one step, so a build that resolves
// the core against the SEGMENT between two consecutive positions — which
// `specs/collision.md` demands, requiring a swept test and forbidding a body
// passing through another in a tick — sees a line straight across the field on
// the tick the round crosses the seam, unless it is written to understand the
// seam. On the star's row that false line runs through the core and the round is
// absorbed (`specs/collision.md`: a bullet that reaches the core is absorbed and
// removed). Off the row it misses, and the fault is invisible. Nothing touches a
// conformant build: the shortest wrapped separation from the seam to the star's
// centre is 637 units against the `CORE_R + BULLET_R` (`33`) at which a round is
// taken.
//
// WHY THE ROUND IS PLACED RATHER THAN FIRED. `addBullet` is the one operation the
// requirement needs; what the gun does when a key is pressed is the `bullets` and
// `controls` items. `startPlaying` has emptied the field and shut both world
// gates, so the crossing is the only thing happening, and thirteen ticks is a
// twelfth of `BULLET_LIFE` (`1.5` s), so nothing expires mid-crossing.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { MUZZLE_SPEED, STAR_X } from "../constants";
import {
  bulletById,
  captureStill,
  createHarness,
  poseBullet,
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
 * The speed the round is flown at: `MUZZLE_SPEED`, the figure
 * `specs/weapons.md` fixes for a shot leaving a still ship.
 */
const CROSS_SPEED = MUZZLE_SPEED;

/** The run-up driven before the crossing: a tenth of a second of approach. */
const APPROACH_TICKS = ticksFor(0.1);

/**
 * How far the wrapped centre may sit from where the modulus puts it, in units.
 *
 * The rule is arithmetic and the reading is taken one tick after the position and
 * velocity it is predicted from, so the only thing a conformant build can be off
 * by over that tick is the well's own contribution to the tick's displacement: at
 * the 637 units the seam stands from the star the pull is 11 units per second
 * squared, which moves the round by 8 thousandths of a unit in one tick. This
 * bound is six hundred times that, still under a quarter of the 2.17 units of
 * overshoot the pose builds in — which is what a build that snaps the coordinate
 * to the edge misses by — and well under `BULLET_R` (`3`), so a build that wraps
 * on the round's edge rather than its centre fails.
 */
const WRAP_TOLERANCE = 0.5;

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

it("wraps a bullet leaving the top edge round to the bottom edge", async () => {
  const { seam, line } = CROSSING;

  await startPlaying(harness);

  const run = approachTo(seam, CROSS_SPEED, APPROACH_TICKS);
  const pose = posedAt(run, line);
  const id = await poseBullet(harness, pose.x, pose.y, pose.vx, pose.vy);

  const crossing = await crossSeam(
    harness,
    run,
    (snapshot) => bulletById(snapshot, id),
    APPROACH_TICKS,
    `bullet leaving the ${seam} edge`,
  );
  await captureStill(harness, "wrap");

  const across = otherAxis(run.axis);
  assertLessThanOrEqual(
    Math.abs(coordinateOn(crossing.after, run.axis) - crossing.expected),
    WRAP_TOLERANCE,
    `the bullet's centre ${run.axis} one tick after leaving the ${seam} edge, which the tick's own motion carried to ${crossing.unwrapped.toFixed(3)}`,
  );
  assertLessThanOrEqual(
    Math.abs(
      coordinateOn(crossing.after, across) -
        coordinateOn(crossing.before, across),
    ),
    WRAP_TOLERANCE,
    `the bullet's centre ${across}, which the crossing leaves alone`,
  );
});
