// instrumentation/torpedo-homing-gate — `setTorpedoHoming(id, false)` shuts one
// torpedo's guidance, so it holds the heading it was launched on past a rock
// squarely inside its forward cone; with its guidance on, the same pose turns it
// onto that rock. `warhead` only.
//
// WHAT THE GATE COVERS. `specs/instrumentation.md`: it "Gates that torpedo's
// guidance alone: the forward-cone acquisition and the turn onto a target. Off, it
// holds its heading. Its travel, its lifetime, and its impacts run on." So the
// reading is the HEADING and nothing else.
//
// WHY THE ITEM IS WORTH ITS OWN POINT. A `setTorpedoHoming` that does nothing is
// invisible until a `torpedo` scenario needs a torpedo to fly straight, and the
// item it then fails — `torpedo/flies-true-through-the-well` — carries the
// `gravity` domain. A broken instrumentation gate would therefore lower the gravity
// rating of a build whose well is perfectly correct, which is exactly the
// misattribution a per-operation item exists to prevent.
//
// THE ROCK IS POSED SQUARELY INSIDE THE CONE, AND NOT ON THE AXIS. Ten degrees off
// the launch heading, against the `TORPEDO_CONE` (15 degrees) half-angle
// `specs/weapons.md` fixes: inside it with room to spare, so a build whose cone is
// a degree or two narrower than the specification still acquires — and far enough
// off the axis that a guided torpedo has a turn to make that a straight one plainly
// does not. A rock placed dead ahead would let a build with no guidance at all read
// identically to one that guided perfectly. THE CHECK VERIFIES THAT GEOMETRY rather
// than assuming it: the bearing is measured off the posed field, at launch and
// again at the reading, and both must lie inside the cone.
//
// AND THE READING IS TAKEN EARLY, WHERE THE ENVIRONMENT HAS NOT MOVED IT. A quarter
// of a second: `specs/weapons.md` turns a torpedo at `TORPEDO_TURN` (160 degrees a
// second), so a guided one has four times the turn it needs and has plainly
// committed, while the rock — which the well does pull, though the torpedo it does
// not — has drifted under two units, a fifth of a degree on this lever arm. A
// window long enough for the torpedo to reach the rock would have been a window
// long enough for the well to have chosen the answer.

import { afterEach, beforeEach, it } from "vitest";
import { TORPEDO_CONE } from "../../src/constants";
import {
  assertGreaterThanOrEqual,
  assertLessThan,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  poseTorpedo,
  rockById,
  startPlaying,
  ticksFor,
  torpedoById,
  type Harness,
} from "../harness";
import { angleGap, degrees, radians, separation } from "../geometry";

/** Where the torpedo is launched, and the heading it carries: straight right. */
const TORPEDO_PLACE = { x: 100, y: 660 } as const;
const LAUNCH_HEADING = 0;

/**
 * Where the rock stands, as a bearing off the launch heading and a range.
 *
 * Ten degrees, inside the `TORPEDO_CONE` (15) half-angle with a third of the cone
 * to spare, at 400 units — far enough that the well moves it by under two units
 * over the window and that the torpedo covers only a quarter of the way in it, so
 * nothing lands and the reading is the turn alone.
 */
const ROCK_BEARING = radians(-10);
const ROCK_RANGE = 400;
const ROCK_PLACE = {
  x: TORPEDO_PLACE.x + ROCK_RANGE * Math.cos(LAUNCH_HEADING + ROCK_BEARING),
  y: TORPEDO_PLACE.y + ROCK_RANGE * Math.sin(LAUNCH_HEADING + ROCK_BEARING),
} as const;

/** How long each leg flies, in ticks: a quarter of a second of game time. */
const FLIGHT_FRAMES = ticksFor(0.25);

/**
 * How far a shut-down torpedo's heading may drift, in radians.
 *
 * Half a degree. `specs/instrumentation.md` says it "holds its heading", so the
 * true figure is zero and this is floating-point slack; it is twenty times smaller
 * than the ten degrees the guided leg has to turn through, so no build can satisfy
 * both legs by accident.
 */
const HOLD_TOLERANCE = radians(0.5);

/**
 * How far a guided torpedo must have turned from its launch heading, in radians.
 *
 * Eight of the ten degrees the rock is posed off the axis. It is a floor rather
 * than a figure: what is being decided is that the guidance ran, and how tightly a
 * build tracks is `torpedo/turns-onto-a-target`'s to grade.
 */
const TURN_FLOOR = radians(8);

/**
 * How near a guided torpedo's heading must end to the bearing to the rock, in
 * radians.
 *
 * Four degrees. `specs/weapons.md` turns the heading "toward that target's current
 * position" every tick at a bounded rate, so a torpedo that has had four times the
 * turn it needed is pointing at the rock; the four degrees leave room for a build
 * whose turn lags the moving bearing by a tick or two, and still separate "turned
 * onto the rock" from "turned somewhere".
 */
const ACQUIRED_TOLERANCE = radians(4);

let h: Harness;

/** What one leg saw: the heading it ended on, and where the rock then stood. */
interface Leg {
  heading: number;
  /** The bearing from the torpedo to the rock at the reading. */
  bearing: number;
  /** The bearing from the torpedo to the rock at launch. */
  launchBearing: number;
}

/**
 * Pose one rock inside the cone, launch one torpedo at it with its guidance set,
 * fly a quarter of a second, and answer what the torpedo did.
 *
 * Nothing else is on the field: no other rock, no saucer, no bullet, so the rock
 * below is the only candidate `specs/weapons.md` could have the torpedo acquire.
 */
async function leg(homing: boolean): Promise<Leg> {
  startPlaying(h);
  const rockId = poseRock(h, "large", ROCK_PLACE.x, ROCK_PLACE.y);
  const torpedoId = poseTorpedo(
    h,
    TORPEDO_PLACE.x,
    TORPEDO_PLACE.y,
    LAUNCH_HEADING,
  );
  if (h.debug.setTorpedoHoming === undefined) {
    fail(
      "a setTorpedoHoming operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.setTorpedoHoming(torpedoId, homing);

  const opened = h.snapshot();
  const launchBearing = bearingTo(
    torpedoById(opened, torpedoId, "the torpedo at launch"),
    rockById(opened, rockId, "the rock at launch"),
  );

  await h.advance(FLIGHT_FRAMES);

  const closed = h.snapshot();
  const torpedo = torpedoById(closed, torpedoId, "the torpedo at the reading");
  const rock = rockById(closed, rockId, "the rock at the reading");
  return {
    heading: torpedo.heading,
    bearing: bearingTo(torpedo, rock),
    launchBearing,
  };
}

/** The bearing from `from` to `to`, across the seams, in radians. */
function bearingTo(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const away = separation(from, to);
  return Math.atan2(away.y, away.x);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the heading with homing off, and turns onto the rock with it on", async () => {
  // ---- The guidance shut --------------------------------------------------
  const held = await leg(false);
  captureStill(h, "held");

  // The scenario really is the one this item claims: the rock was inside the
  // forward cone when the torpedo launched, and it was still inside it at the
  // reading, so a build with working guidance had a target throughout.
  assertLessThan(
    angleGap(LAUNCH_HEADING, held.launchBearing),
    TORPEDO_CONE,
    "the rock's bearing off the launch heading, against TORPEDO_CONE " +
      `(${degrees(TORPEDO_CONE).toFixed(0)} degrees, specs/weapons.md)`,
  );
  assertLessThan(
    angleGap(held.heading, held.bearing),
    TORPEDO_CONE,
    "the rock's bearing off the held heading at the reading, still inside the cone",
  );

  assertLessThanOrEqual(
    angleGap(held.heading, LAUNCH_HEADING),
    HOLD_TOLERANCE,
    "how far a torpedo with setTorpedoHoming(id, false) turned from the heading " +
      "it was launched on, in radians",
  );

  // ---- And the same pose with its guidance on -----------------------------
  const guided = await leg(true);
  assertGreaterThanOrEqual(
    angleGap(guided.heading, LAUNCH_HEADING),
    TURN_FLOOR,
    "how far a torpedo with setTorpedoHoming(id, true) turned from its launch " +
      "heading, in radians (specs/weapons.md: it turns onto the nearest " +
      "candidate in its cone)",
  );
  assertLessThanOrEqual(
    angleGap(guided.heading, guided.bearing),
    ACQUIRED_TOLERANCE,
    "how far the guided torpedo's heading ended from the bearing to the rock, " +
      "in radians: it turned ONTO the rock",
  );
});
