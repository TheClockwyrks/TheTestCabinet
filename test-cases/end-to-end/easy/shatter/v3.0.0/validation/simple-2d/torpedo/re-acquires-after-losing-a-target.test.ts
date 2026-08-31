// torpedo/re-acquires-after-losing-a-target — guidance is re-evaluated every tick.
//
// `specs/weapons.md`, "The guidance": "Every tick a torpedo looks for a target ...
// With no candidate this tick, it flies straight on its current heading. It
// re-evaluates every tick, so it acquires, loses, and re-acquires targets over its
// flight." A build that locks onto the first body it sees and keeps steering at
// where that body WAS — or that stops steering for good once its target is gone —
// breaks that sentence, and this is the item that reads all three beats of it.
//
// THREE BEATS, IN ORDER, AND EACH IS ASSERTED.
//
//   1. ACQUIRES. With a rock `12` degrees off its heading, the torpedo turns toward
//      it. Without this the two beats after it would be read of a torpedo that never
//      steered at all.
//   2. LOSES. The rock is taken off the field with `removeRock`, which
//      `specs/instrumentation.md` makes a removal rather than a kill, and over the
//      quarter of a second that follows the heading does not move: "with no
//      candidate this tick, it flies straight on its current heading". A build still
//      steering at a remembered position keeps turning here.
//   3. RE-ACQUIRES. A second rock is posed `12` degrees off the heading the torpedo
//      now holds, on the OTHER side, and the torpedo turns back the other way. The
//      opposite side is what makes the third reading impossible to score by
//      accident: a build that had simply carried on turning from beat 1 is turning
//      the wrong way.
//
// THE SECOND ROCK IS POSED OFF THE HEADING THE BUILD REPORTS, not off the heading
// the check expected it to reach. The bearing that matters is the one from the
// torpedo's own position on its own heading, so the scenario is arranged around what
// the build actually did, and a build that turned a little less than another still
// gets a rock squarely inside its cone.
//
// THE FLIGHT RUNS ALONG THE TOP LANE, AND THAT IS FORCED BY THE FIELD BEING A TORUS.
// Bearings are taken from the shortest wrapped separation, so a body more than `360`
// units down the field is nearer the other way and its bearing points backward; a
// target posed several hundred units ahead therefore goes along `x`, where the
// half-width is `640` (see `scene.ts`). Nothing in the scenario comes within `240`
// units of the star, so the well moves neither rock by a unit over the flight and
// moves the torpedo not at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { DEG } from "../../src/constants";
import { angleBetween, angleGap, degrees } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  poseTorpedo,
  startPlaying,
  torpedoById,
  type Harness,
} from "../harness";
import { HEADING_RIGHT, TOP_LANE, pointAt } from "./scene";

/** How far off the heading each rock is posed, in degrees: inside the cone. */
const OFF_AXIS_DEG = 12;

/** The first rock's range, in units: far enough that it is never reached. */
const FIRST_RANGE = 300;

/** The second rock's range, in units. */
const SECOND_RANGE = 300;

/** How long the torpedo is given to turn onto each rock, in ticks. */
const TURN_TICKS = 6;

/** How long it is watched flying with nothing to steer at, in ticks. */
const STRAIGHT_TICKS = 30;

/**
 * The least each turn must carry the heading, in radians.
 *
 * Four degrees: three ticks of the `TORPEDO_TURN` (`160` degrees per second)
 * ceiling, so a torpedo that turns at any honest rate clears it in the six ticks
 * read, and a torpedo that does not turn cannot.
 */
const TURN_NEEDED = 4 * DEG;

/**
 * How far the heading may move while there is nothing to steer at, in radians.
 *
 * One degree, the short way round, over a quarter of a second — during which a build
 * still turning at the ceiling would sweep `40`.
 */
const STRAIGHT_TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns onto a rock, flies straight when it is taken away, then turns onto a second", async () => {
  startPlaying(h);

  // 1. Acquires: a rock clockwise of the heading.
  const firstAt = pointAt(
    TOP_LANE,
    HEADING_RIGHT + OFF_AXIS_DEG * DEG,
    FIRST_RANGE,
  );
  const first = poseRock(h, "small", firstAt.x, firstAt.y);
  const id = poseTorpedo(h, TOP_LANE.x, TOP_LANE.y, HEADING_RIGHT);

  await h.advance(TURN_TICKS);
  const acquired = torpedoById(
    h.snapshot(),
    id,
    "the torpedo turning onto its first target",
  );
  assertGreaterThanOrEqual(
    degrees(angleBetween(HEADING_RIGHT, acquired.heading)),
    degrees(TURN_NEEDED),
    `the degrees the torpedo turned toward a rock +${OFF_AXIS_DEG} degrees off ` +
      `its heading over ${TURN_TICKS} ticks — the control that makes the two ` +
      "readings after it a reading of losing and re-acquiring a target " +
      "(specs/weapons.md)",
  );

  // 2. Loses: the rock is removed, and the heading must stop moving.
  h.debug.removeRock(first);
  await h.advance(STRAIGHT_TICKS);
  const coasting = torpedoById(
    h.snapshot(),
    id,
    "the torpedo flying on with no candidate",
  );
  const drifted = angleGap(coasting.heading, acquired.heading);
  assertLessThanOrEqual(
    drifted,
    STRAIGHT_TOLERANCE,
    `the radians the torpedo's heading moved over ${STRAIGHT_TICKS} ticks with ` +
      "its target taken off the field (specs/weapons.md: with no candidate this " +
      "tick, it flies straight on its current heading); " +
      `${degrees(drifted).toFixed(3)} degrees`,
  );

  // 3. Re-acquires: a second rock, the other side of the heading it now holds.
  const secondAt = pointAt(
    coasting,
    coasting.heading - OFF_AXIS_DEG * DEG,
    SECOND_RANGE,
  );
  poseRock(h, "small", secondAt.x, secondAt.y);
  await h.advance(TURN_TICKS);
  const reacquired = torpedoById(
    h.snapshot(),
    id,
    "the torpedo turning onto its second target",
  );
  // The torpedo turning onto its second target.
  captureStill(h, "reacquired");

  assertGreaterThanOrEqual(
    -degrees(angleBetween(coasting.heading, reacquired.heading)),
    degrees(TURN_NEEDED),
    "the degrees the torpedo turned back the other way onto a second rock " +
      `-${OFF_AXIS_DEG} degrees off the heading it was holding, over ` +
      `${TURN_TICKS} ticks (specs/weapons.md: it re-evaluates every tick, so it ` +
      "acquires, loses, and re-acquires targets over its flight); a build still " +
      "turning the way it was reads a negative number here",
  );
});
