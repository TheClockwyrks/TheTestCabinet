// flight/rotation-keeps-velocity — turning points the nose somewhere else and
// leaves the ship's motion exactly where it was.
//
// THE RULE. `specs/ship.md`, "Inertial flight", the Rotation row ends: "Rotation
// changes the facing alone and never the velocity." The file says the same thing
// again in prose — the ship "has no reverse and no brake: speed is killed by
// turning around and thrusting against the motion" — which is the whole of
// Shatter's handling. A build that carries the velocity round with the nose is
// not flying an inertial ship at all, and a build that sheds speed for turning
// has given the player a brake the specification denies them.
//
// WHAT IS MEASURED. The whole velocity VECTOR after a second of held rotation
// with no thrust, against the vector the drag alone leaves — the posed velocity
// multiplied by `0.5 ^ (1 / SHIP_DRAG_HALFLIFE)` (`0.7937`), which is the ONLY
// thing the specification lets touch it over that second. One reading decides
// both halves at once: a direction that moved and a magnitude that moved are the
// same failure of the same sentence, and reading them as the length of the
// difference states how far the build's velocity ended from the specified one in
// the units the figure is quoted in.
//
// THE DRAG IS SUBTRACTED RATHER THAN TOLERATED. Over the second the drag takes
// `61.9` units per second off a `300` drift, which is seven times the bound — so
// a check that simply asked for the velocity to be unchanged would fail every
// conforming build, and one that widened its bound to swallow the drag would
// stop deciding anything. The specification fixes the drag exactly, so the
// expected vector includes it.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. The drift is laid at `25`
// degrees and the turn is a full `300`, so a build that rotates the velocity with
// the facing ends `238` out — the chord of a `300`-degree swing at the dragged
// speed. A build that zeroes the velocity when a turn key goes down is `238` out.
// A build that halves it is `119` out. A build that turns without dragging at all
// is `61.9` out. The bound is `9`.
//
// WHY 3 PERCENT OF THE POSED DRIFT IS HONEST. The only latitude a conforming
// build has here is which side of the tick its drag falls on: one tick is `0.19`
// percent, `0.46` units per second, a twentieth of the bound. The rest is room
// for a build's own arithmetic, not room on the rule.
//
// THE FACING STARTS AWAY FROM THE DRIFT. The ship faces `FACE_UP` while drifting
// at `25` degrees, so a build that ties the two together is already wrong before
// the key goes down, and the turn is held for a second — a full `300` degrees —
// so a build that carries the velocity round cannot land back where it started.
//
// NOTHING ELSE TOUCHES THE VELOCITY. No thrust key is held. The well never pulls
// the ship (`specs/ship.md`), and `startPlaying` has emptied the field and shut
// both world gates, so nothing arrives. The drift carries the ship `268` units
// from `(200, 200)` along `25` degrees, which never brings it within `200` of the
// star's centre — clear of the `44` at which `specs/collision.md`'s slide begins,
// and the slide is the one rule that could take a component off a velocity here.
// THE RATE of the turn is `flight/turn-rate-left`'s item, not this one; this
// check never reads the facing.

import { afterEach, beforeEach, it } from "vitest";
import { FACE_UP } from "../../src/constants";
import { assertCloseTo, assertLessThanOrEqual } from "../assert";
import { DEG } from "../geometry";
import {
  captureStill,
  createHarness,
  holdActionFor,
  startPlaying,
  ticksFor,
  seconds as secondsOf,
  type Harness,
} from "../harness";
import { keptOver } from "./motion";

/** Where the ship is posed: off both axes and well clear of the core. */
const SHIP_X = 200;
const SHIP_Y = 200;

/** The drift it carries, laid across its facing so no wrong model reads as the right one. */
const DRIFT_SPEED = 300;
const DRIFT_HEADING = 25 * DEG;
const DRIFT = {
  vx: Math.cos(DRIFT_HEADING) * DRIFT_SPEED,
  vy: Math.sin(DRIFT_HEADING) * DRIFT_SPEED,
};

/** The hold the review item names: one second of game time on a turn key. */
const TURN_TICKS = ticksFor(1);

/** The velocity `specs/ship.md` leaves after that second: the drift, dragged, unturned. */
const KEPT = keptOver(secondsOf(TURN_TICKS));
const WANTED = { vx: DRIFT.vx * KEPT, vy: DRIFT.vy * KEPT };

/**
 * How far the velocity may fall from it, in units per second.
 *
 * 3 percent of the posed drift — `9` units per second, against the `0.46` the
 * one tick of drag the specification leaves open is worth, and against the `238`
 * a build that rotates the velocity with the facing is out by.
 */
const VELOCITY_TOLERANCE = 0.03 * DRIFT_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship's velocity where it was, less what the drag alone takes", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipAngle(FACE_UP);
  h.debug.setShipVelocity(DRIFT.vx, DRIFT.vy);

  const posed = h.snapshot().ship;
  assertCloseTo(
    Math.hypot(posed.vx - DRIFT.vx, posed.vy - DRIFT.vy),
    0,
    2,
    `the ship drifting at ${DRIFT_SPEED} units per second along ` +
      `${(DRIFT_HEADING / DEG).toFixed(0)} degrees before the turn, so the ` +
      "velocity the turn is held against is the one this scenario posed " +
      "(specs/instrumentation.md: setShipVelocity)",
  );

  await holdActionFor(h, "left", TURN_TICKS);
  const ship = h.snapshot().ship;
  // The ship a full turn later, still drifting the way it was pointed.
  captureStill(h, "drift");

  const missed = Math.hypot(ship.vx - WANTED.vx, ship.vy - WANTED.vy);

  assertLessThanOrEqual(
    missed,
    VELOCITY_TOLERANCE,
    `the ship's velocity after a second of held rotation with no thrust to be ` +
      `within ${VELOCITY_TOLERANCE.toFixed(1)} units per second of ` +
      `(${WANTED.vx.toFixed(1)}, ${WANTED.vy.toFixed(1)}) — the posed drift ` +
      `with only the drag's 0.5 ^ (1 / SHIP_DRAG_HALFLIFE) taken off it, since ` +
      "rotation changes the facing alone and never the velocity " +
      "(specs/ship.md); measured as the length of the difference, from " +
      `(${ship.vx.toFixed(1)}, ${ship.vy.toFixed(1)})`,
  );
});
