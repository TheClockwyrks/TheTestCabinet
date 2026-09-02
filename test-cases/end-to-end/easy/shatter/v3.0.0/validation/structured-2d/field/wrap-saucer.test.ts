// field/wrap-saucer — a saucer driven off the top edge re-enters at the bottom,
// and the reverse.
//
// THE RULE. `specs/field.md` makes the field a torus and keeps a coordinate in
// range by taking it modulo the field size on that axis. `specs/saucer.md` states
// the saucer's share of it in so many words: it enters at one side on a row drawn
// at random, and "it wraps at the top and bottom edges like any body". Top and
// bottom are what this item decides, because they are the two the saucer's own
// travel takes it through — its cruise is horizontal and its weave is vertical.
//
// WHAT IS READ. The pair of ticks the wrap lies between (see `seams.ts`): the
// tick's own motion says how far past the seam the craft went and the rule says
// where that lands. A build that snaps the coordinate to the far edge, one that
// reflects it, one that re-enters a radius late, and one that treats the edge as
// the end of the visit each read as a different number. The saucer's identity is
// read with it, so a build that ends the visit at the seam and starts a fresh one
// at the other edge fails rather than passing on a craft that merely looks right.
//
// WHY THE CROSSING IS FLOWN WITH THE MIND AND THE GUN OFF. `specs/saucer.md`
// gives the saucer three separable faculties and this requirement is its travel
// alone. With `setSaucerMind(false)` the weave cannot reroll the vertical
// velocity the crossing is predicted from, and with `setSaucerGun(false)` the
// visit fires nothing across the seam it is being read at. `setSaucerTravel` is
// left ON, because the locomotion is the requirement.
//
// WHY THIS COLUMN. `420` is clear of the star's whole drawn extent — nothing of
// the star is drawn beyond `1.5 x HALO_R` (`180`) of the centre — and clear of
// the ship at its safe point, so the crossing is the only thing in the frame. The
// star's own column buys nothing here: the collision table in
// `specs/collision.md` pairs the core with a bullet, a rock and the ship, and not
// with the saucer, so a build with a seam-blind swept core test has nothing to do
// to a saucer.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
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
 * The speed the saucer is flown at: `SAUCER_SPEED`, its own cruise, turned to run
 * up the field instead of across it.
 */
const CROSS_SPEED = SAUCER_SPEED;

/** The column the crossing is flown along. See the header for why this one. */
const COLUMN = 420;

/** The run-up driven before the crossing: a tenth of a second of approach. */
const APPROACH_TICKS = ticksFor(0.1);

/**
 * How far the wrapped centre may sit from where the modulus puts it, in units.
 *
 * The saucer is a powered craft the well never touches (`specs/gravity.md`) and
 * it carries no drag, so a conformant build's centre after the tick is its centre
 * plus its velocity over `TICK_DT` exactly, and the only deviation left is
 * floating-point rounding, some orders of magnitude below anything stated here.
 * The bound is therefore set by what it has to separate rather than by what it
 * has to forgive: a quarter of the 0.58 units of overshoot the pose builds in,
 * which is what a build that snaps the coordinate to the edge misses by, and a
 * hundred-and-thirtieth of `SAUCER_R` (`18`), so a build that wraps on the
 * craft's edge rather than its centre fails.
 */
const WRAP_TOLERANCE = 0.14;

/** The crossing whose picture is kept as the item's still. */
const RECORDED: Seam = "bottom";

/** The two crossings `specs/saucer.md` names for the saucer. */
const CROSSINGS: readonly { seam: Seam; to: Seam }[] = [
  { seam: "bottom", to: "top" },
  { seam: "top", to: "bottom" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it.each(CROSSINGS)(
  "wraps a saucer leaving the $seam edge round to the $to edge",
  async ({ seam }) => {
    startPlaying(h);

    const run = approachTo(seam, CROSS_SPEED, APPROACH_TICKS);
    const pose = posedAt(run, COLUMN);
    const id = poseSaucer(h, pose.x, pose.y);
    // `addSaucer` brings the craft on cruising to the right with every faculty
    // running; the crossing is its TRAVEL alone, so the course is turned up the
    // field and the other two faculties are shut, one atom at a time.
    h.debug.setSaucerVelocity(pose.vx, pose.vy);
    h.debug.setSaucerMind(false);
    h.debug.setSaucerGun(false);

    const crossing = await crossSeam(
      h,
      run,
      (snapshot) =>
        snapshot.saucer !== null && snapshot.saucer.id === id
          ? snapshot.saucer
          : undefined,
      APPROACH_TICKS,
      `saucer leaving the ${seam} edge`,
    );
    if (seam === RECORDED) captureStill(h, "wrap");

    const across = otherAxis(run.axis);
    assertLessThanOrEqual(
      Math.abs(coordinateOn(crossing.after, run.axis) - crossing.expected),
      WRAP_TOLERANCE,
      `the saucer's centre ${run.axis} one tick after leaving the ${seam} edge, ` +
        `which the tick's own motion carried to ${crossing.unwrapped.toFixed(3)}`,
    );
    assertLessThanOrEqual(
      Math.abs(
        coordinateOn(crossing.after, across) -
          coordinateOn(crossing.before, across),
      ),
      WRAP_TOLERANCE,
      `the saucer's centre ${across}, which the crossing leaves alone`,
    );
  },
);
