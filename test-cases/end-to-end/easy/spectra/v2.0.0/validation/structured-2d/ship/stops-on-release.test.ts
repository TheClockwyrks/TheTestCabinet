// ship/stops-on-release — the ship stops in the frame its direction is released.
//
// specs/ship.md, "Movement": the ship "stops in the frame the direction is
// released, with no drift and no inertia". The review item states the reading: a
// tenth of a second after the release, the ship stands within ONE UNIT of where the
// release left it. A build that eases the ship to a halt, or carries it on at a
// decaying speed, moves further than that; a build that stops dead does not move at
// all.
//
// EACH RUN-UP IS HALF A SECOND OF THE HELD DIRECTION, so every release is a release
// from real motion rather than from a standstill: a ship that never moved would
// satisfy any bound on its drift, and the check asserts that the run-up actually
// carried it before it reads anything afterwards. That precondition is a tenth of
// the ground `SHIP_SPEED` covers in the window — far below any conformant build and
// far above standing still — and deliberately not a reading of the speed, which is
// `ship/move-left`'s and `ship/move-right`'s point.
//
// BOTH DIRECTIONS ARE RELEASED, one after the other, because a build carries its
// inertia in whichever direction it was travelling and the rule is stated of the
// direction, not of one of them: a build that halts dead on a released RIGHT and
// coasts on a released LEFT has the defect this point exists to name, and would go
// unread if only one release were taken. What is read is the same reading twice,
// not two requirements — the other two engines read this point the same way, since
// the scenario belongs to the case rather than to the runtime. How far a HELD
// direction carries the ship is not read here at all; that is `ship/move-left` and
// `ship/move-right`.
//
// NOTHING IS HELD DURING EITHER COASTING TENTH. `holdActionFor` lets the key up
// before it returns, and no key goes down again, so anything that moves the ship
// over the frames that follow is the build's own momentum. Each release is taken
// with more than the ground `SHIP_SPEED` could cover in the tenth still ahead of
// the ship, so neither bound of the lane can be what stops it.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so nothing arrives
// to cost a life and return the ship to the centre of its lane mid-reading.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_SPEED, SHIP_X_MAX, SHIP_X_MIN } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdActionFor,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The review item's own bound on the drift, in logical units. */
const DRIFT_TOLERANCE = 1;

/** The run-up: half a second of the held direction, so a release is from motion. */
const RUN_UP_SECONDS = 0.5;
const RUN_UP_FRAMES = ticksFor(RUN_UP_SECONDS);

/** The window the drift is read over: the tenth of a second the item names. */
const COAST_SECONDS = 0.1;
const COAST_FRAMES = ticksFor(COAST_SECONDS);

/**
 * How far the run-up must have carried the ship for the release to be a release
 * from motion.
 *
 * A precondition on the SCENARIO, not a reading of the ship's speed — that is
 * `ship/move-left`'s and `ship/move-right`'s point. A tenth of the ground
 * `SHIP_SPEED` covers in the run-up: no conformant build is near it, and a ship
 * that stood still is nowhere above it.
 */
const RUN_UP_MIN = SHIP_SPEED * RUN_UP_SECONDS * 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Run the ship up on `action` for the run-up, release it, and answer how far it
 * drifted over the coasting tenth that follows.
 *
 * The run-up and the room ahead of the ship are asserted as PRECONDITIONS of the
 * scenario, not as readings of this point: without the first the release is a
 * release from a standstill, which any build survives, and without the second the
 * lane's own bound could be what brought the ship to rest.
 */
async function driftAfterRelease(
  action: "left" | "right",
  roomAhead: (x: number) => number,
): Promise<number> {
  const before = h.snapshot().ship.x;
  await holdActionFor(h, action, RUN_UP_FRAMES);
  const atRelease = h.snapshot().ship.x;

  assertGreaterThan(
    Math.abs(atRelease - before),
    RUN_UP_MIN,
    `the units the ship travelled over ${String(RUN_UP_SECONDS)}s of held ` +
      `${action}, so the release read below is a release from motion`,
  );
  assertGreaterThan(
    roomAhead(atRelease),
    SHIP_SPEED * COAST_SECONDS,
    `the units of lane left in front of the ship when ${action} was released, ` +
      "so the bound cannot be what stops it",
  );

  await h.advance(COAST_FRAMES);
  return Math.abs(h.snapshot().ship.x - atRelease);
}

it("leaves the ship where the release left it a tenth of a second later", async () => {
  startPosed(h);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the screen that reads the direction actions",
  );
  assertEqual(
    before.phase,
    "live",
    "the ship is flying rather than respawning",
  );

  const rightDrift = await driftAfterRelease("right", (x) => SHIP_X_MAX - x);
  // Before the assertions, so a check that fails still leaves the picture of
  // where the coasting tenth carried the ship.
  captureStill(h, "stopped");

  const leftDrift = await driftAfterRelease("left", (x) => x - SHIP_X_MIN);

  assertLessThanOrEqual(
    rightDrift,
    DRIFT_TOLERANCE,
    `the units the ship moved in the ${String(COAST_SECONDS)}s after RIGHT was ` +
      "released, with no key down — the ship stops in the frame its direction " +
      "is released, with no drift and no inertia (specs/ship.md)",
  );
  assertLessThanOrEqual(
    leftDrift,
    DRIFT_TOLERANCE,
    `the units the ship moved in the ${String(COAST_SECONDS)}s after LEFT was ` +
      "released, with no key down — the same rule in the other direction, " +
      "which is where a build's inertia may show instead (specs/ship.md)",
  );
});
