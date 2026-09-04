// torpedo/flies-true-through-the-well — the star does not bend a torpedo.
//
// THE RULE. `specs/gravity.md` lists what the well pulls and what it does not:
// under `warhead`, "The ship, the saucer, and the torpedo are powered craft with
// their own drive. The well NEVER adds anything to their velocity, whatever their
// distance from the star, so each holds exactly the course it is steering."
// `specs/weapons.md` says the same from the other side: "The well never pulls a
// torpedo, so it holds its own course straight through the gravity the star
// exerts." A bullet fired along this same line is bent hard —
// `gravity/bullet-curves` reads that — so this item is the difference between the
// two, and it is why the item's domains are gravity as well as arcade.
//
// THE READING IS TAKEN PAST THE STAR'S COLUMN. The torpedo is followed for
// `FLIGHT_TICKS` (240), which at `TORPEDO_SPEED` carries it `840` units — from
// `x = 218`, through the star's column at `x = 640`, and out to `x = 1058` on the
// far side. That is the whole point of the span: the closest approach to the well
// happens at the star's column, and a reading taken before it would be taken
// before the thing the item exists to prove it flies through. (The previous
// version of this case stopped at `x = 554`, short of the column, which is the
// fold-in fix this span carries.)
//
// THE LANE IS `100` UNITS ABOVE THE STAR'S ROW, NOT ON IT. A torpedo whose centre
// reached the star's own row would pass through the core, and `specs/collision.md`
// has the core absorb a torpedo that reaches it — there would be nothing left to
// read. `y = 260` clears the core comfortably — the absorption radius is
// `CORE_R + TORPEDO_R` = `36`, so the flight passes with `64` units to spare — and
// still stands outside the softening radius `SOFTEN` (`90`), where
// `specs/gravity.md`'s law is the plain inverse square rather than its cap. At
// `100` units the well pulls at `MU / 100^2` = `450` units per second squared, so
// a build that pulled the torpedo would be bent by hundreds of units over this
// span — or would fall into the core and be absorbed, which the hard assertion
// names.
//
// THE GUIDANCE IS HELD OFF, and that is what makes the item decidable. With
// `setTorpedoHoming(id, false)` the forward cone is not evaluated at all
// (`specs/instrumentation.md`), so a build that wrongly treats the star as an
// acquirable body cannot confound the reading: the only thing left that could turn
// this torpedo is the well.
//
// THE PATH, THE HEADING AND THE VELOCITY ARE ALL READ AT EVERY TICK, NOT JUST AT
// THE ENDS. Every sample over the span must lie within `4` units of the straight
// line the torpedo was posed on, its heading must be within a degree of the one it
// was posed on, and its reported velocity within a unit per second of the one it
// began with — each at every one of the 240 ticks. A torpedo that dives toward the
// star and swings back out is caught in the middle even if it happens to end near
// the line and on its original heading, which reading only the ends would let
// through. And the flight is asserted to have COVERED the span — a torpedo that
// never moved would sit on its own line for ever, and that is not a torpedo flying
// true through anything. How far it should have got is `torpedo/speed`'s figure;
// what is asserted here is only that it passed the column the well is at.
//
// THE VELOCITY IS READ BECAUSE IT IS THE RULE'S OWN WORDS. The path bound is a
// bound on the CONSEQUENCE; `specs/gravity.md` states the rule about the velocity —
// "the well never adds anything to their velocity". A build that lets the well
// accelerate its torpedo but rebuilds the velocity from the heading at the top of
// the next tick puts only a third of a unit of drift into each tick's position and
// drifts under two units over the whole crossing — inside the four the path may
// stray by, and no player would see it — while its reported velocity picks up the
// whole of a tick's pull, `450 / 120` units per second at the closest approach.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_R, STAR_X, STAR_Y, TORPEDO_R } from "../constants";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { DEG, angleBetween } from "../geometry";
import {
  captureReplay,
  createHarness,
  requireTorpedo,
  sampleEvery,
  startPlaying,
  type Harness,
} from "../harness";
import { holdItsHeading, poseTorpedo, standTheShipClear } from "./scenario";

/** The lane: 100 units above the star's row. See the note above on why not on it. */
const LANE_Y = STAR_Y - 100;
/** Where the run starts, so 240 ticks of travel end at about x = 1058. */
const START_X = 218;
/** Along `+x`, straight across the well. */
const HEADING = 0;

/** How far the torpedo is followed: 840 units, past the star's column. */
const FLIGHT_TICKS = 240;
/**
 * How often the flight is sampled, in ticks: every one of them.
 *
 * Every tick rather than every other, so the path, the heading and the velocity are
 * each read at the same resolution the other two engines' suites read them at, and
 * a build bent for a single tick has nowhere between two samples to hide it.
 */
const SAMPLE_EVERY = 1;
/** A little more flight after the reading, so the recording ends on the outcome. */
const TAIL_TICKS = 48;

/**
 * How far the path may stray from the line it was posed on, in units.
 *
 * `4`, the figure the review item states. The specification leaves the torpedo
 * untouched by the well, so a conforming build's path is the line exactly and
 * this is room for its arithmetic alone — a fifteenth of the `64` units of
 * clearance the lane has over the core, and three orders of magnitude short of
 * the bend `MU / 100^2` would put into a body the well did pull.
 */
const LINE_TOLERANCE = 4;

/**
 * How far the heading may have moved over the span, in radians.
 *
 * One degree, the figure the review item states. Compared as the SHORTEST ARC
 * between two angles, never as a subtraction: a heading names a direction and the
 * case fixes no range for it, so a build that keeps its headings in `[0, 2pi)`
 * would report a hair below straight as `6.28` rather than as `-0.003` — the same
 * flight, a whole turn of apparent error.
 */
const HEADING_TOLERANCE = 1 * DEG;

/**
 * How far the reported velocity may move over the whole flight, in units per
 * second.
 *
 * One. With the guidance shut off `specs/instrumentation.md` has the torpedo hold
 * its heading, and `specs/weapons.md` holds its speed constant, so a conformant
 * build's velocity does not change at all over the crossing — it reads the same
 * float on every tick — and this is not room on the rule. It is a quarter of the
 * `MU / 260^2 / TICK_HZ` = `3.75` units per second that ONE tick of the well's pull
 * at this lane's closest approach would add, so a build that lets a single tick of
 * the pull reach its torpedo's velocity reads outside it however quickly it wipes
 * it again.
 */
const VELOCITY_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a torpedo's heading and its line across the star's own column", async () => {
  startPlaying(h);
  standTheShipClear(h);
  const id = poseTorpedo(h, START_X, LANE_Y, HEADING);
  holdItsHeading(h, id);

  const path = await captureReplay(h, "true", async () => {
    const samples = await sampleEvery(h, FLIGHT_TICKS, SAMPLE_EVERY, (s) =>
      s.torpedoes?.find((torpedo) => torpedo.id === id),
    );
    // And the rest of the run out the far side, for the reviewer.
    await h.advance(TAIL_TICKS);
    return samples;
  });

  // A hard reading of the torpedo the run ends with: it survived the crossing.
  requireTorpedo(
    h.snapshot(),
    id,
    "the torpedo still in flight past the star's column — the well never adds " +
      "anything to a torpedo's velocity, so nothing should have carried it " +
      "into the core the way it carries a bullet (specs/gravity.md, " +
      "specs/collision.md)",
  );

  const arrived = path[path.length - 1];
  assertGreaterThan(
    arrived?.x ?? Number.NEGATIVE_INFINITY,
    STAR_X,
    `the torpedo past the star's column (x = ${STAR_X}) at the end of the ` +
      `${FLIGHT_TICKS}-tick span, so the reading is taken after its closest ` +
      "approach to the well rather than before it (specs/weapons.md); it " +
      `started at x = ${START_X}`,
  );

  const opening = path[0];
  assertTrue(
    opening !== undefined,
    "the torpedo on the field before the run begins, so the velocity it held " +
      "at the start is the one the crossing is read against " +
      "(specs/instrumentation.md)",
  );

  let strayed = 0;
  let turned = 0;
  let shifted = 0;
  for (const [index, sample] of path.entries()) {
    assertTrue(
      sample !== undefined,
      `the torpedo in flight for the whole ${FLIGHT_TICKS}-tick span; it was ` +
        `gone by tick ${index * SAMPLE_EVERY}, which on this lane means the ` +
        "core absorbed it — and the well never pulls a torpedo " +
        "(specs/gravity.md)",
    );
    if (sample === undefined || opening === undefined) continue;
    strayed = Math.max(strayed, Math.abs(sample.y - LANE_Y));
    turned = Math.max(turned, angleBetween(sample.heading, HEADING));
    shifted = Math.max(
      shifted,
      Math.hypot(sample.vx - opening.vx, sample.vy - opening.vy),
    );
  }

  assertLessThanOrEqual(
    strayed,
    LINE_TOLERANCE,
    `the torpedo's path within ${LINE_TOLERANCE} units of the straight line ` +
      `y = ${LANE_Y} it was posed on, at every one of the ${FLIGHT_TICKS} ` +
      "ticks of the crossing — the well never adds anything to a torpedo's " +
      "velocity (specs/gravity.md); at its worst it stood " +
      `${strayed.toFixed(2)} units off it, with the star ` +
      `${CORE_R + TORPEDO_R} units of absorption radius below the lane`,
  );

  assertLessThanOrEqual(
    shifted,
    VELOCITY_TOLERANCE,
    "the units per second the torpedo's reported velocity moved over the " +
      `crossing, at its worst, against the (${opening?.vx.toFixed(1)}, ` +
      `${opening?.vy.toFixed(1)}) it began with (specs/gravity.md: the well ` +
      "never adds anything to a torpedo's velocity, whatever its distance " +
      "from the star; specs/instrumentation.md: with its homing off it holds " +
      "its heading)",
  );

  assertLessThanOrEqual(
    turned,
    HEADING_TOLERANCE,
    "the torpedo's heading unchanged across the well, at every one of the " +
      `${FLIGHT_TICKS} ticks, within ` +
      `${(HEADING_TOLERANCE / DEG).toFixed(0)} degree of the ${HEADING} it was ` +
      "posed on, with its guidance held off so nothing but the well could turn " +
      `it (specs/gravity.md, specs/instrumentation.md); at its worst it read ` +
      `${(turned / DEG).toFixed(3)} degrees off`,
  );
});
