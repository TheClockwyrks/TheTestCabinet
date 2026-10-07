// field/wrap-carries-velocity — a body's velocity is unchanged across a wrap.
//
// THE RULE. `specs/field.md` states it beside the wrap itself: "a body carries its
// velocity across unchanged", and `specs/rocks.md` repeats it for a rock, which
// wraps at the field's edges carrying its velocity across. The wrap is a change of
// position and nothing else. This is the item that says so; where the wrapped
// centre lands is the five `wrap-*` items, one per body.
//
// WHY THE TOLERANCE IS THE TICK'S OWN ACCELERATION. The two readings are one tick
// apart, and a rock is a ballistic body the well pulls every tick
// (`specs/gravity.md`), so a conformant build's velocity legitimately differs
// between them by exactly one tick of that pull. Nothing else may differ, and
// each wrong model differs by far more: a build that reflects the body at the
// seam reverses 140 units per second, one that re-launches it on a fresh course
// zeroes or replaces both components, and one that rebuilds the velocity from the
// wrapped position loses the component along the crossing.
//
// WHY BOTH COMPONENTS ARE NON-ZERO. A crossing flown straight along an axis
// cannot tell a build that carries the whole velocity from one that carries only
// the component along the crossing. Posing `140` along the seam's axis and `50`
// across it separates them: the component the wrap does not act on is the one a
// build rebuilding its velocity from the wrap drops.
//
// WHY BOTH AXES. A build can carry the velocity through a horizontal wrap and
// rebuild it at a vertical one, so the reading is taken at a vertical seam as well
// as at a horizontal one, in one item, because it is one requirement read twice
// rather than two requirements.
//
// WHY THE CROSSINGS ARE FLOWN WHERE THEY ARE. Far from the star, so the pull the
// tolerance has to leave room for is as small as the field allows: each crossing
// is more than six hundred units out, where the well adds under 0.11 units per
// second in a tick. And the reading is only taken once the wrap has happened, so
// a build that clamps its bodies at the edge instead of wrapping them fails here
// rather than passing on a velocity that never crossed anything.
//
// The pose is a Medium at `148.7` units per second, inside the `90`–`150` band
// `specs/rocks.md` fixes for its size, so nothing about it is a drift the game
// would not itself hand out.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT } from "../constants";
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
  velocityOn,
  type Seam,
} from "./seams";

/** The component of the drift along the seam's own axis, in units per second. */
const ALONG_SPEED = 140;

/** The component across it, so a build that drops one of the two is caught. */
const ACROSS_SPEED = 50;

/** The run-up driven before the crossing: a tenth of a second of approach. */
const APPROACH_TICKS = ticksFor(0.1);

/**
 * How much either component of the velocity may move across the wrap, in units
 * per second.
 *
 * The two readings are one tick apart, so what a conformant build may legitimately
 * add is one tick of the well's pull. Both crossings are flown more than six
 * hundred units from the star, where `specs/gravity.md`'s law gives at most 12.2
 * units per second squared and one tick of it is 0.102 units per second. This
 * bound is three and a half times that, and still four hundred times under the
 * `140` a build that reverses or discards the component along the crossing loses.
 */
const VELOCITY_TOLERANCE = 0.35;

/**
 * How far from the opposite edge the body may be for the wrap to count as having
 * happened, in units.
 *
 * Not a reading of where the wrap put it — that is the `wrap-rock-*` items' point, decided to
 * a fifth of a unit — but the precondition this item's own reading rests on: a
 * velocity carried "across a wrap" says nothing about a build that never wrapped.
 * One tick of the drift is 1.17 units, so two ticks of it admits any modulo a
 * build can write and excludes a build that clamped the body at the edge or
 * reflected it.
 */
const RE_ENTRY_MAX = 2 * ALONG_SPEED * TICK_DT;

/** The crossing whose picture is kept as the item's still. */
const RECORDED: Seam = "right";

/** One crossing per axis, each flown far out from the star. */
const CROSSINGS: readonly { seam: Seam; to: Seam; line: number }[] = [
  { seam: "right", to: "left", line: 150 },
  { seam: "bottom", to: "top", line: 150 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(CROSSINGS)(
  "carries a rock's velocity across the $seam seam unchanged",
  async ({ seam, line }) => {
    startPlaying(h);

    const run = approachTo(seam, ALONG_SPEED, APPROACH_TICKS);
    const pose = posedAt(run, line, ACROSS_SPEED);
    const id = poseRock(h, "medium", pose.x, pose.y, pose.vx, pose.vy);

    const crossing = await crossSeam(
      h,
      run,
      (snapshot) => snapshot.rocks.find((rock) => rock.id === id),
      APPROACH_TICKS,
      `rock leaving the ${seam} edge`,
    );
    if (seam === RECORDED) captureStill(h, "wrap");

    // The rock really did come out of the far edge, which is what "across a wrap"
    // means. Coarse on purpose: where exactly it landed is the `wrap-rock-*` items' point.
    const landed = coordinateOn(crossing.after, run.axis);
    assertLessThanOrEqual(
      run.velocity > 0 ? landed : run.size - landed,
      RE_ENTRY_MAX,
      `the rock's centre ${run.axis} back inside the field at the opposite edge`,
    );

    const across = otherAxis(run.axis);
    assertLessThanOrEqual(
      Math.abs(
        velocityOn(crossing.after, run.axis) -
          velocityOn(crossing.before, run.axis),
      ),
      VELOCITY_TOLERANCE,
      `the rock's v${run.axis}, the component along the crossing, across the ` +
        `${seam} seam`,
    );
    assertLessThanOrEqual(
      Math.abs(
        velocityOn(crossing.after, across) -
          velocityOn(crossing.before, across),
      ),
      VELOCITY_TOLERANCE,
      `the rock's v${across}, the component across the crossing, across the ` +
        `${seam} seam`,
    );
  },
);
