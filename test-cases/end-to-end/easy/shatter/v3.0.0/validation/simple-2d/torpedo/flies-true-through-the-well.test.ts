// torpedo/flies-true-through-the-well — the star does not bend a torpedo.
//
// `specs/gravity.md`, "Which bodies are pulled": a torpedo is not. "The ship, the
// saucer, and the torpedo are powered craft with their own drive. The well never
// adds anything to their velocity, whatever their distance from the star, so each
// holds exactly the course it is steering." `specs/weapons.md` says it again from
// the weapon's side: "The well never pulls a torpedo, so it holds its own course
// straight through the gravity the star exerts." A bullet on the same line is bent
// hard — the pull `100` units out is `MU / 100^2`, `450` units per second squared —
// so this is the one item that separates a build which exempts its torpedo from one
// which integrates every body the same way.
//
// THE READING IS TAKEN PAST THE STAR'S COLUMN, AND THAT IS FOLD-IN FIX D. The
// torpedo is followed for `240` ticks — two seconds, from `x = 218` out to about
// `x = 1058` — so the closest approach to the well, at the star's column of `640`,
// falls in the MIDDLE of the run rather than at its end. A flight that stopped short
// of `640` would take its reading before the well had its chance, which is exactly
// what the version this reworks did.
//
// THE GUIDANCE IS OFF, AND THAT IS WHAT MAKES THE ITEM DECIDABLE.
// `setTorpedoHoming(id, false)` "gates that torpedo's guidance alone: the
// forward-cone acquisition and the turn onto a target. Off, it holds its heading"
// (`specs/instrumentation.md`). With it off, the only thing left that could turn
// this torpedo is the well, so a build that treats the star as an acquirable body
// cannot confound the reading — and `instrumentation/torpedo-homing-gate` is the
// item that grades the gate itself.
//
// THE LANE PASSES 100 UNITS ABOVE THE CORE: far enough that a conformant torpedo is
// never absorbed (they touch at `CORE_R + TORPEDO_R` = `36`,
// `specs/collision.md`), close enough that the well's pull there is fifty times
// what it is at the field's edge. The closest approach the path actually made is
// checked before the flight is judged, so a build whose torpedo never reached the
// well cannot pass this by flying straight somewhere else — and it is measured to
// the LINE between samples rather than to the samples, which is the reading
// `geometry.ts` exists to make honest.
//
// THE PATH IS READ AT EVERY TICK, not at the ends. A torpedo that were pulled in and
// slung back out could leave the run on its original line while having been bent the
// whole way; every sample is held against the straight line instead.
//
// AND THE VELOCITY IS READ AT EVERY TICK TOO, WHICH IS THE RULE'S OWN WORDS. The
// path bound is a bound on the CONSEQUENCE; `specs/gravity.md` states the rule about
// the velocity — "the well never adds anything to their velocity". A build that lets
// the well accelerate its torpedo but rebuilds the velocity from the heading at the
// top of the next tick puts only a third of a unit of drift into each tick's
// position and drifts under two units over the whole crossing — inside the four the
// path may stray by, and no player would see it — while its reported velocity picks
// up the whole of a tick's pull, `450 / 120` units per second at the closest
// approach. So the velocity is held against the velocity the flight began with, and
// the two readings together leave a build no version of this fault to hold.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { DEG, STAR_X, STAR_Y } from "../../src/constants";
import { STAR, angleGap, closestApproachTo, degrees } from "../geometry";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { HEADING_RIGHT, flyTorpedo, poseStraight } from "./scene";

/** How far above the star's row the lane runs, in units. */
const LANE_OFFSET = 100;

/** The lane the torpedo flies: `100` units above the star's row. */
const LANE_Y = STAR_Y - LANE_OFFSET;

/** Where it starts, so `240` ticks at `TORPEDO_SPEED` carry it out to about 1058. */
const FROM_X = 218;

/** How far it is followed, in ticks: two seconds, past the star's column at 640. */
const FLIGHT_TICKS = 240;

/** The ticks of flight the replay keeps once the reading has been taken. */
const TAIL_TICKS = ticksFor(0.3);

/**
 * How far off the straight line the path may stray, in units.
 *
 * Four, the manifest's own allowance, against a torpedo `12` units across. It is not
 * room on the rule — the well adds nothing at all — but the floor a float position
 * summed over `240` ticks earns. A bullet on this lane is pulled `450` units per
 * second squared at its closest approach and leaves the line by hundreds.
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
 * How far the reported velocity may move over the whole flight, in units per second.
 *
 * One. With the guidance shut off `specs/instrumentation.md` has the torpedo hold
 * its heading, and `specs/weapons.md` holds its speed constant, so a conformant
 * build's velocity does not change at all over the crossing — it reads the same
 * float on every tick — and this is not room on the rule. It is a quarter of the
 * `MU / 260^2 / TICK_HZ` = `3.75` units per second that ONE tick of the well's pull
 * at this lane's closest approach would add, so a build that lets a single tick of
 * the pull reach its torpedo's velocity reads outside it however quickly it wipes it
 * again.
 */
const VELOCITY_TOLERANCE = 1;

/**
 * How near the star's centre the path must have come for the reading to mean
 * anything, in units.
 *
 * The lane's own `100`, and ten more for a build whose torpedo is a little slow. It
 * is not a bound on the requirement: it refuses to grade "the well did not bend it"
 * against a flight that never reached the well.
 */
const APPROACH_NEEDED = LANE_OFFSET + 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds its line and its heading across the well, out past the star's column", async () => {
  startPlaying(h);
  const id = poseStraight(h, FROM_X, LANE_Y, HEADING_RIGHT);

  const flight = await captureReplay(h, "true", async () => {
    const flown = await flyTorpedo(h, id, FLIGHT_TICKS);
    // The clip runs on past the reading, so it ends on the torpedo out the far
    // side rather than on the frame the verdict was taken from.
    await h.advance(TAIL_TICKS);
    return flown;
  });

  if (flight.ticks < FLIGHT_TICKS) {
    const last = flight.path[flight.path.length - 1];
    fail(
      `a torpedo still in flight after ${FLIGHT_TICKS} ticks (2 s) of its ` +
        "TORPEDO_LIFE (3.5 s), having crossed the well (specs/weapons.md, " +
        "specs/gravity.md: the well never pulls a torpedo)",
      `it left the roster after ${flight.ticks} ticks, at ` +
        `(${last.x.toFixed(1)}, ${last.y.toFixed(1)})`,
    );
  }

  const approach = closestApproachTo(STAR, flight.path).distance;
  if (approach > APPROACH_NEEDED) {
    fail(
      `a flight that reached the well, coming within ${APPROACH_NEEDED} units ` +
        'of the star\'s centre, so that "the well does not bend it" is read of ' +
        "a torpedo that crossed it (specs/gravity.md)",
      `its closest approach to (${STAR_X}, ${STAR_Y}) was ` +
        `${approach.toFixed(1)} units`,
    );
  }

  const strayed = flight.path.reduce(
    (most, at) => Math.max(most, Math.abs(at.y - LANE_Y)),
    0,
  );
  assertLessThanOrEqual(
    strayed,
    LINE_TOLERANCE,
    "the units the torpedo's path strayed from the straight line it was " +
      `launched on, at its worst over ${FLIGHT_TICKS} ticks passing ` +
      `${LANE_OFFSET} units from the star's centre (specs/gravity.md: the well ` +
      "never adds anything to a torpedo's velocity, whatever its distance from " +
      "the star)",
  );

  const opening = flight.velocities[0];
  const shifted = flight.velocities.reduce(
    (most, v) =>
      Math.max(most, Math.hypot(v.vx - opening.vx, v.vy - opening.vy)),
    0,
  );
  assertLessThanOrEqual(
    shifted,
    VELOCITY_TOLERANCE,
    "the units per second the torpedo's reported velocity moved over the " +
      `crossing, against the (${opening.vx.toFixed(1)}, ${opening.vy.toFixed(1)}) ` +
      "it began with (specs/gravity.md: the well never adds anything to a " +
      "torpedo's velocity, whatever its distance from the star; " +
      "specs/instrumentation.md: with its homing off it holds its heading)",
  );

  const turned = flight.headings.reduce(
    (most, heading) => Math.max(most, angleGap(heading, HEADING_RIGHT)),
    0,
  );
  assertLessThanOrEqual(
    turned,
    HEADING_TOLERANCE,
    "the radians the torpedo's heading turned across the well, the short way " +
      "round (specs/gravity.md, specs/weapons.md: it holds its own course " +
      `straight through the gravity the star exerts); ${degrees(turned).toFixed(3)} degrees`,
  );
});
