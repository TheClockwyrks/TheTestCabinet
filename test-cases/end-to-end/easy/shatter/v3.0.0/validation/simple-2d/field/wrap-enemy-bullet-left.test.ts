// field/wrap-enemy-bullet-left — an enemy bullet driven off the left edge re-enters at the
// right one, its centre wrapping modulo the field size.
//
// ONE SEAM, ONE POINT. Each edge an enemy bullet crosses is an item of its
// own, because each is a separate branch in practically every build: `if (x >
// FIELD_W) x -= FIELD_W` with no `x < 0` branch wraps off one edge and not the
// mirror of it. A build that wraps off the left edge and not the right one has
// to grade differently from one that wraps off neither, and a single verdict
// taken over every seam at once cannot say which edge broke. So this check
// reads the left edge and nothing else; its siblings
// `field/wrap-enemy-bullet-right`, `field/wrap-enemy-bullet-top` and
// `field/wrap-enemy-bullet-bottom` read the others.
//
// THE RULE. `specs/field.md` makes the field a torus with no outer walls and
// keeps a coordinate in range by taking it modulo the field size on that axis:
// "the wrap applies to every body on the field". `specs/saucer.md` says it again
// for the saucer's round — "it is pulled by the well and wraps at the edges like
// any ballistic body". This is the body a build most often forgets, which is why
// it is an item of its own rather than a second reading inside another one.
//
// WHAT IS READ. The pair of ticks the wrap lies between (see `seams.ts`): the
// tick's own motion says how far past the seam the round went and the rule says
// where that lands. A build that snaps the coordinate to the far edge, one that
// reflects it, one that re-enters a radius late, and one that quietly drops enemy
// fire at the boundary each read as a different number.
//
// WHY THE CROSSINGS ARE FLOWN ON THE STAR'S OWN ROW AND COLUMN. A wrap moves a
// coordinate the whole width of the field in one step, so a build that resolves
// the core against the SEGMENT between two consecutive positions — which
// `specs/collision.md` demands, requiring a swept test and forbidding a body
// passing through another in a tick — sees a line straight across the field on
// the tick the round crosses the seam, unless it is written to understand the
// seam. On the star's row that false line runs through the core and the round is
// absorbed (`specs/collision.md`: a saucer bullet that reaches the core is
// absorbed and removed). Off the row the fault is invisible. A conformant build
// is untouched: the shortest wrapped separation from the seam to the star's
// centre is 640 units across its row and 360 down its column, against the
// `CORE_R + SAUCER_BULLET_R` (`33`) at which a round is taken.
//
// WHY THE ROUND IS PLACED RATHER THAN FIRED. `addEnemyBullet` is the one
// operation the requirement needs; when and where the saucer shoots is the
// `saucer` items. `startPlaying` has emptied the field, shut both world gates and
// shut the ship's lethal contact test, so no saucer arrives to fire a second
// round and nothing the round passes costs a life. Thirteen ticks is a tenth of
// `SAUCER_BULLET_LIFE` (`1.4` s), so nothing expires mid-crossing.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_BULLET_SPEED, STAR_Y } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseEnemyBullet,
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
 * The speed the round is flown at: `SAUCER_BULLET_SPEED`, the figure
 * `specs/saucer.md` fixes for a shot leaving a still saucer.
 */
const CROSS_SPEED = SAUCER_BULLET_SPEED;

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
 * This bound is a hundred and twenty times that. It is also a quarter of the 1.25
 * units of overshoot the pose builds in — the gap a build that snaps the
 * coordinate to the edge misses by — and a tenth of `SAUCER_BULLET_R` (`3`), so a
 * build that wraps on the round's edge rather than its centre fails.
 */
const WRAP_TOLERANCE = 0.3;

/** The one crossing this item decides: off the left edge, round to the right one. */
const CROSSING: { seam: Seam; to: Seam; line: number } = {
  seam: "left",
  to: "right",
  line: STAR_Y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps an enemy bullet leaving the left edge round to the right edge", async () => {
  const { seam, line } = CROSSING;

  startPlaying(h);

  const run = approachTo(seam, CROSS_SPEED, APPROACH_TICKS);
  const pose = posedAt(run, line);
  const id = poseEnemyBullet(h, pose.x, pose.y, pose.vx, pose.vy);

  const crossing = await crossSeam(
    h,
    run,
    (snapshot) => snapshot.enemyBullets.find((bullet) => bullet.id === id),
    APPROACH_TICKS,
    `enemy bullet leaving the ${seam} edge`,
  );
  captureStill(h, "wrap");

  const across = otherAxis(run.axis);
  assertLessThanOrEqual(
    Math.abs(coordinateOn(crossing.after, run.axis) - crossing.expected),
    WRAP_TOLERANCE,
    `the enemy bullet's centre ${run.axis} one tick after leaving the ` +
      `${seam} edge, which the tick's own motion carried to ` +
      `${crossing.unwrapped.toFixed(3)}`,
  );
  assertLessThanOrEqual(
    Math.abs(
      coordinateOn(crossing.after, across) -
        coordinateOn(crossing.before, across),
    ),
    WRAP_TOLERANCE,
    `the enemy bullet's centre ${across}, which the crossing leaves alone`,
  );
});
