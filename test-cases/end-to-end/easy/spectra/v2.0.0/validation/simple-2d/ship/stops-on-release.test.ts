// Spectra — ship/stops-on-release: the ship stops in the frame the direction is
// released.
//
// THE RULE. `specs/ship.md`: the ship "stops in the frame the direction is
// released, with no drift and no inertia". The review item states the reading:
// releasing the direction leaves the ship within one unit of where it stood a
// tenth of a second later.
//
// WHY BOTH DIRECTIONS ARE RELEASED. It is one requirement — that a released
// direction leaves NO residual motion — and a build carries its residue in a
// velocity, an easing or a smoothed input that a single direction cannot pin down:
// a ship that keeps a signed velocity drifts on after a left hold and on after a
// right one, while a ship that eases only toward a target x may look still after
// one and drift after the other. Both legs assert the same thing, and each names
// its own direction, so the failure says which release drifted.
//
// WHAT ONE UNIT IS, AND WHY IT IS THE RIGHT BOUND. `SHIP_SPEED` is 360 units a
// second, so the tenth of a second measured here covers 36 units of travel at
// speed. A build with real inertia — even a tenth of the ship's speed bled off
// over that window — moves several units; a build that stops dead moves none. One
// unit sits between the two by a wide margin in both directions, and it is the
// review item's own figure.
//
// THE MEASUREMENT TAKES NOTHING FROM THE HOLD. The reading is taken from where the
// ship stood at the RELEASE, not from where the hold started, so how far the hold
// carried it is `ship/move-left`'s and `ship/move-right`'s point and not this
// one's.
//
// TWO PRECONDITIONS STAND BETWEEN THAT AND A CHECK THAT DECIDES NOTHING. A
// release is only a release from MOTION if the hold moved the ship at all: a
// build whose ship never answers a direction stands perfectly still for the tenth
// of a second after every release, and would pass this point on the strength of
// being broken. And a ship stopped by the lane's own bound is not a ship that
// stopped because the key came up. Each leg therefore asserts that the hold
// carried the ship, and that the lane ahead of it is longer than the coasting
// tenth could be, before it reads the drift. Neither is a reading of the build's
// speed — that is `ship/move-left`'s and `ship/move-right`'s point, and the
// floors below sit an order of magnitude under the figure so that this point
// cannot charge for it twice.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so nothing but the keys can move the ship, and nothing can drop it
// into the `ready` phase, where `specs/progression.md` re-centres it.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_SPEED, SHIP_X_MAX, SHIP_X_MIN } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  LANE_CENTER,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The keys the two holds are delivered on: the first of each of the build's. */
const LEFT_KEY = BINDINGS.left[0];
const RIGHT_KEY = BINDINGS.right[0];

/**
 * How long each direction is held before it is released.
 *
 * Long enough that a build carrying inertia has reached its full speed — 0.3 s is
 * 108 units of travel at `SHIP_SPEED` — and short enough that both legs stay well
 * inside `[SHIP_X_MIN, SHIP_X_MAX]` from the centre of the lane.
 */
const HOLD_SECONDS = 0.3;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

/** The tenth of a second the review item measures the drift over. */
const SETTLE_SECONDS = 0.1;
const SETTLE_TICKS = ticksFor(SETTLE_SECONDS);

/**
 * The review item's bound on that drift: one unit.
 *
 * A thirty-sixth of the 36 units `SHIP_SPEED` covers in the same tenth of a
 * second, so it admits the floating-point residue of an integration that really
 * did stop and nothing that is still moving.
 */
const DRIFT_MAX = 1;

/**
 * How far a hold must have carried the ship for its release to be a release from
 * motion, in logical units.
 *
 * A tenth of the ground `SHIP_SPEED` covers over `HOLD_SECONDS` — 10.8 units
 * against the 108 a conforming build travels. A precondition on the SCENARIO and
 * not a reading of the speed: no conforming build comes near it, and a ship that
 * stood still through the hold is nowhere above it.
 */
const RUN_UP_MIN = SHIP_SPEED * HOLD_SECONDS * 0.1;

/**
 * How much lane must lie ahead of the ship at the release, in logical units.
 *
 * The whole of what the coasting tenth could carry a ship still travelling at
 * `SHIP_SPEED`, so the bound cannot be what brings a drifting ship to rest and
 * flatter the reading below.
 */
const ROOM_MIN = SHIP_SPEED * SETTLE_SECONDS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship where the release left it, after either direction", async () => {
  startPosed(h);
  const opening = h.snapshot();
  assertEqual(
    opening.screen,
    "inWave",
    "the wave the keys are held in is live",
  );
  assertEqual(
    opening.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertEqual(opening.ship.x, LANE_CENTER, "the ship starts mid-lane");

  await holdFor(h, LEFT_KEY, HOLD_TICKS);
  const leftReleased = h.snapshot().ship.x;
  assertGreaterThan(
    Math.abs(leftReleased - opening.ship.x),
    RUN_UP_MIN,
    `the units the ship travelled over ${String(HOLD_SECONDS)}s of held LEFT, ` +
      "so the release read below is a release from motion rather than from a " +
      "standstill (specs/ship.md)",
  );
  assertGreaterThan(
    leftReleased - SHIP_X_MIN,
    ROOM_MIN,
    `the units of lane between the ship and SHIP_X_MIN ` +
      `(${String(SHIP_X_MIN)}) when LEFT was released, so the lane's bound ` +
      "cannot be what stops a drifting ship (specs/field.md)",
  );
  await h.advance(SETTLE_TICKS);
  const leftSettled = h.snapshot().ship.x;

  assertLessThanOrEqual(
    Math.abs(leftSettled - leftReleased),
    DRIFT_MAX,
    `the units the ship drifted in the ${String(SETTLE_SECONDS)}s after LEFT ` +
      `was released, where holding it covers ${String(SHIP_SPEED)} units a ` +
      "second (specs/ship.md)",
  );

  const beforeRight = h.snapshot().ship.x;
  await holdFor(h, RIGHT_KEY, HOLD_TICKS);
  const rightReleased = h.snapshot().ship.x;
  assertGreaterThan(
    Math.abs(rightReleased - beforeRight),
    RUN_UP_MIN,
    `the units the ship travelled over ${String(HOLD_SECONDS)}s of held RIGHT, ` +
      "so the release read below is a release from motion rather than from a " +
      "standstill (specs/ship.md)",
  );
  assertGreaterThan(
    SHIP_X_MAX - rightReleased,
    ROOM_MIN,
    `the units of lane between the ship and SHIP_X_MAX ` +
      `(${String(SHIP_X_MAX)}) when RIGHT was released, so the lane's bound ` +
      "cannot be what stops a drifting ship (specs/field.md)",
  );
  await h.advance(SETTLE_TICKS);
  // Before the assertion, so a check that fails still leaves the picture of where
  // the release left the ship.
  captureStill(h, "stopped");
  const rightSettled = h.snapshot().ship.x;

  assertLessThanOrEqual(
    Math.abs(rightSettled - rightReleased),
    DRIFT_MAX,
    `the units the ship drifted in the ${String(SETTLE_SECONDS)}s after RIGHT ` +
      `was released, where holding it covers ${String(SHIP_SPEED)} units a ` +
      "second (specs/ship.md)",
  );
});
