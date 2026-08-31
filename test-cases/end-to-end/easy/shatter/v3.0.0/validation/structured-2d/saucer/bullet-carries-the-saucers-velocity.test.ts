// saucer/bullet-carries-the-saucers-velocity — a round leaves at the aim speed ON
// TOP OF whatever the craft was doing.
//
// THE RULE. `specs/saucer.md`, Firing: "The bullet leaves at
// `SAUCER_BULLET_SPEED` (`300`) along that bearing, plus the saucer's own
// velocity." So the round's velocity MINUS the craft's is `300` units per second,
// whatever the craft was carrying and whichever way the shot went — and that
// difference is what this point reads.
//
// WHY THE DIFFERENCE AND NOT THE SPEED. Reading the round's own speed would demand
// a particular bearing, which is a draw the specification leaves open
// (`+/- SAUCER_AIM_ERROR`); the difference is `300` for every legal draw. Reading
// it against the POSED velocity rather than the reported one is deliberate too:
// what "the saucer's own velocity" means here is the course the scenario put the
// craft on, so a build that stores the course but does not add it into the shot is
// caught. That the surface reports back what it was given is
// `instrumentation/set-saucer-velocity-reads-back`'s point, not this one's.
//
// THE COURSE AND THE SHIP ARE PLACED SO EVERY WRONG MODEL READS AS A DIFFERENT
// NUMBER. The craft is posed on `(SAUCER_SPEED, -SAUCER_WEAVE_SPEED)` —
// `(140, -90)`, a course the specification's own cruise and weave produce, of
// magnitude `166.4` — and the ship is put `400` units away in the direction
// OPPOSITE that course. A conformant build then reads exactly `300`; a build that
// ignores the craft's velocity reads `466`; a build that subtracts it instead of
// adding reads `633`. The opposite direction is what makes those three furthest
// apart: with the ship anywhere else the aim and the course would partly cancel.
//
// THE CRAFT IS HELD STILL, and that is the isolation. `setSaucerTravel(false)`
// stops its centre moving, so the bearing to the ship is one number and the round
// leaves from where the scenario put the craft — while `setSaucerVelocity` leaves
// the craft carrying the course the round is supposed to inherit. The mind is shut
// so the weave cannot reroll that course out from under the shot. See `shots.ts`.
//
// THE THREE PERCENT is `9` units per second, a tolerance on the reading rather
// than room on the figure. The round is read on the tick it joins the roster,
// before the well has had a tick to work on it; three percent covers a build whose
// arithmetic rounds and is fifty times short of the smallest of the wrong readings
// above.

import { afterEach, beforeEach, it } from "vitest";
import {
  SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_SPEED,
  SAUCER_WEAVE_SPEED,
} from "../../src/constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseShip,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { collectShots, poseGunner } from "./shots";

/** Where the gunner stands, and the course its round must inherit. */
const GUN_POSE = {
  x: 1100,
  y: 120,
  vx: SAUCER_SPEED,
  vy: -SAUCER_WEAVE_SPEED,
};

/** How far the ship is posed from the gunner, in units. */
const RANGE = 400;

/** The ship, placed against the course: see the header for why opposite. */
const COURSE = Math.hypot(GUN_POSE.vx, GUN_POSE.vy);
const SHIP_X = GUN_POSE.x - (RANGE * GUN_POSE.vx) / COURSE;
const SHIP_Y = GUN_POSE.y - (RANGE * GUN_POSE.vy) / COURSE;

/** The window driven, in seconds: one fire interval and a fifth of one. */
const WINDOW = 1.2 * SAUCER_FIRE_INTERVAL;

/** The three percent of SAUCER_BULLET_SPEED the item allows the reading. */
const TOLERANCE = 0.03 * SAUCER_BULLET_SPEED;

let h: Harness;

beforeEach(async () => {
  // The default clock: one tick a frame, so the round is read on the tick it
  // left, before the well has had a tick to work on it.
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives a round SAUCER_BULLET_SPEED on top of the course the saucer was carrying", async () => {
  startPlaying(h);
  poseShip(h, { x: SHIP_X, y: SHIP_Y, vx: 0, vy: 0 });
  poseGunner(h, GUN_POSE);

  const shots = await collectShots(h, GUN_POSE, 1, ticksFor(WINDOW));
  // A shot leaving a moving saucer.
  captureStill(h, "shot");

  assertLength(
    shots,
    1,
    `rounds the saucer fired over ${WINDOW.toFixed(2)} s of game time — one is ` +
      `due one SAUCER_FIRE_INTERVAL (${SAUCER_FIRE_INTERVAL} s) after the pose ` +
      "(specs/saucer.md, specs/instrumentation.md)",
  );

  const shot = shots[0];
  const over = Math.hypot(shot.vx - GUN_POSE.vx, shot.vy - GUN_POSE.vy);

  assertLessThanOrEqual(
    Math.abs(over - SAUCER_BULLET_SPEED),
    TOLERANCE,
    `how far the round's velocity, less the (${GUN_POSE.vx}, ${GUN_POSE.vy}) ` +
      `the saucer was posed on, missed SAUCER_BULLET_SPEED ` +
      `(${SAUCER_BULLET_SPEED}) by — a round leaves at that speed along its ` +
      `bearing PLUS the saucer's own velocity (specs/saucer.md); the round left ` +
      `at (${shot.vx.toFixed(1)}, ${shot.vy.toFixed(1)})`,
  );
});
