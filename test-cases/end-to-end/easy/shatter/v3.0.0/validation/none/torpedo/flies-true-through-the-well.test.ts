// torpedo/flies-true-through-the-well — the star does not bend a torpedo.
//
// specs/gravity.md, "Which bodies are pulled": a torpedo is not, and "The ship, the
// saucer, and the torpedo are powered craft with their own drive. The well never
// adds anything to their velocity, whatever their distance from the star, so each
// holds exactly the course it is steering." specs/weapons.md says it again from the
// weapon's side: "The well never pulls a torpedo, so it holds its own course
// straight through the gravity the star exerts." A bullet on the same line is bent
// hard — the pull `100` units out is `MU / 100^2`, `450` units per second squared —
// so this is the one item that separates a build which exempts its torpedo from one
// which integrates every body the same way.
//
// THE READING IS TAKEN PAST THE STAR'S COLUMN, AND THAT IS FOLD-IN FIX D. The
// torpedo is followed for `240` ticks — two seconds, from `x = 218` out to about
// `x = 1058` — so the closest approach to the well, at the star's column of `640`,
// falls in the MIDDLE of the run rather than at its end. A flight that stopped
// short of `640` would take its reading before the well had its chance, which is
// exactly what the version this reworks did.
//
// THE GUIDANCE IS OFF, AND THAT IS WHAT MAKES THE ITEM DECIDABLE.
// `setTorpedoHoming(id, false)` "gates that torpedo's guidance alone: the
// forward-cone acquisition and the turn onto a target. Off, it holds its heading"
// (specs/instrumentation.md). With it off, the only thing left that could turn this
// torpedo is the well, so a build that treats the star as an acquirable body cannot
// confound the reading — and `instrumentation/torpedo-homing-gate` is the item that
// grades the gate itself.
//
// THE LANE PASSES 100 UNITS ABOVE THE CORE: far enough that a conformant torpedo is
// never absorbed (they touch at `CORE_R + TORPEDO_R` = `36`, specs/collision.md),
// close enough that the well's pull there is fifty times what it is at the field's
// edge. The closest approach the path actually made is checked before the flight is
// judged, so a build whose torpedo never reached the well cannot pass this by
// flying straight somewhere else.
//
// THE PATH IS READ AT EVERY TICK, not at the ends. A torpedo that were pulled in
// and slung back out could leave the run on its original line while having been
// bent the whole way; every sample is held against the straight line instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { DEG, STAR_X, STAR_Y } from "../constants";
import { angleBetween, closestApproach } from "../geometry";
import {
  captureReplay,
  createHarness,
  poseTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { flyTorpedo, HEADING_RIGHT } from "./scene";

/** The lane the torpedo flies: `100` units above the star's row. */
const LANE_Y = STAR_Y - 100;

/** Where it starts, so `240` ticks at `TORPEDO_SPEED` carry it out to about 1058. */
const FROM_X = 218;

/** How far it is followed, in ticks: two seconds, past the star's column at 640. */
const FLIGHT_TICKS = 240;

/** The ticks of flight the replay keeps once the reading has been taken. */
const TAIL_TICKS = ticksFor(0.3);

/**
 * How far off the straight line the path may stray, in units.
 *
 * Four, the manifest's own allowance, against a torpedo `12` units across. It is
 * not room on the rule — the well adds nothing at all — but the floor a float
 * position summed over 240 ticks earns. A bullet on this lane is pulled `450` units
 * per second squared at its closest approach and leaves the line by hundreds.
 */
const LINE_TOLERANCE = 4;

/**
 * How far the heading may turn over the whole flight, in radians.
 *
 * One degree, the manifest's own allowance, compared the short way round: a heading
 * names a direction and the specification fixes no range for it, so a build keeping
 * headings in `[0, 2pi)` must not read as a whole turn of error.
 */
const HEADING_TOLERANCE = 1 * DEG;

/**
 * How near the star's centre the path must have come for the reading to mean
 * anything, in units.
 *
 * The lane's own `100`, and ten more for a build whose torpedo is a little slow.
 * It is not a bound on the requirement: it refuses to grade "the well did not bend
 * it" against a flight that never reached the well.
 */
const APPROACH_NEEDED = 110;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds its line and its heading across the well, out past the star's column", async () => {
  await startPlaying(h);
  const id = await poseTorpedo(h, FROM_X, LANE_Y, HEADING_RIGHT, {
    homing: false,
  });

  const flight = await captureReplay(h, "true", async () => {
    const flown = await flyTorpedo(h, id, FLIGHT_TICKS);
    // The clip runs on past the reading, so it ends on the torpedo out the far
    // side rather than on the frame the verdict was taken from.
    await h.advance(TAIL_TICKS);
    return flown;
  });

  if (flight.ticks < FLIGHT_TICKS) {
    fail(
      `a torpedo still in flight after ${FLIGHT_TICKS} ticks (2 s) of its ` +
        `TORPEDO_LIFE (3.5 s), having crossed the well (specs/weapons.md, ` +
        `specs/gravity.md: the well never pulls a torpedo)`,
      `it left the roster after ${flight.ticks} ticks, at ` +
        `(${flight.path[flight.path.length - 1].x.toFixed(1)}, ` +
        `${flight.path[flight.path.length - 1].y.toFixed(1)})`,
    );
  }

  const approach = closestApproach(flight.path, { x: STAR_X, y: STAR_Y });
  if (approach > APPROACH_NEEDED) {
    fail(
      `a flight that reached the well, coming within ${APPROACH_NEEDED} units ` +
        `of the star's centre, so that "the well does not bend it" is read of a ` +
        `torpedo that crossed it (specs/gravity.md)`,
      `its closest approach was ${approach.toFixed(1)} units`,
    );
  }

  const strayed = flight.path.reduce(
    (most, at) => Math.max(most, Math.abs(at.y - LANE_Y)),
    0,
  );
  assertLessThanOrEqual(
    strayed,
    LINE_TOLERANCE,
    `the units the torpedo's path strayed from the straight line it was ` +
      `launched on, at its worst over ${FLIGHT_TICKS} ticks passing ` +
      `${STAR_Y - LANE_Y} units from the star's centre (specs/gravity.md: the ` +
      `well never adds anything to a torpedo's velocity, whatever its distance ` +
      `from the star)`,
  );

  const turned = flight.headings.reduce(
    (most, heading) => Math.max(most, angleBetween(heading, HEADING_RIGHT)),
    0,
  );
  assertLessThanOrEqual(
    turned,
    HEADING_TOLERANCE,
    `the radians the torpedo's heading turned across the well, the short way ` +
      `round (specs/gravity.md, specs/weapons.md: it holds its own course ` +
      `straight through the gravity the star exerts); ${(turned / DEG).toFixed(3)} degrees`,
  );
});
