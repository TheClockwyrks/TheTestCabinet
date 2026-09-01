// ship/stops-on-release — the ship stops in the frame its direction is released.
//
// specs/ship.md, "Movement": the ship "stops in the frame the direction is
// released, with no drift and no inertia". The review item states the reading: a
// tenth of a second after the release, the ship stands within ONE UNIT of where the
// release left it. A build that eases the ship to a halt, or carries it on at a
// decaying speed, moves further than that; a build that stops dead does not move at
// all.
//
// THE RUN-UP IS HALF A SECOND OF HELD RIGHT, so the release is a release from real
// motion rather than from a standstill: a ship that never moved would satisfy any
// bound on its drift, and the check asserts that the run-up actually carried it
// before it reads anything afterwards. That precondition is a tenth of the ground
// `SHIP_SPEED` covers in the window — far below any conformant build and far above
// standing still — and deliberately not a reading of the speed, which is
// `ship/move-right`'s point.
//
// ONE DIRECTION, ONCE. The rule is about what a RELEASE leaves behind, and a build
// with inertia has it in whichever direction it was travelling, so the release is
// read once, from the right. The two directions are not two edge cases of this rule;
// they are `ship/move-left` and `ship/move-right`, which decide travel.
//
// NOTHING IS HELD DURING THE COASTING TENTH. `holdActionFor` lets the key up before
// it returns, and no key goes down again, so anything that moves the ship over the
// frames that follow is the build's own momentum. The lane has 420 units of room
// left in front of the ship at the release, so the clamp cannot be what stops it.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so nothing arrives
// to cost a life and return the ship to the centre of its lane mid-reading.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_SPEED, SHIP_X_MAX } from "../../src/constants";
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

/** The run-up: half a second of held right, so the release is from real motion. */
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
 * `ship/move-right`'s point. A tenth of the ground `SHIP_SPEED` covers in the
 * run-up: no conformant build is near it, and a ship that stood still is nowhere
 * above it.
 */
const RUN_UP_MIN = SHIP_SPEED * RUN_UP_SECONDS * 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship where the release left it a tenth of a second later", async () => {
  startPosed(h);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the screen that reads the right action",
  );
  assertEqual(
    before.phase,
    "live",
    "the ship is flying rather than respawning",
  );

  await holdActionFor(h, "right", RUN_UP_FRAMES);
  const atRelease = h.snapshot().ship.x;
  assertGreaterThan(
    atRelease - before.ship.x,
    RUN_UP_MIN,
    `the units the ship travelled over ${String(RUN_UP_SECONDS)}s of held ` +
      "right, so the release below is a release from motion",
  );
  assertGreaterThan(
    SHIP_X_MAX - atRelease,
    SHIP_SPEED * COAST_SECONDS,
    "the units of lane left in front of the ship at the release, so the " +
      "clamp cannot be what stops it",
  );

  await h.advance(COAST_FRAMES);
  // Before the assertion, so a check that fails still leaves the picture of where
  // the coasting tenth carried the ship.
  captureStill(h, "stopped");

  assertLessThanOrEqual(
    Math.abs(h.snapshot().ship.x - atRelease),
    DRIFT_TOLERANCE,
    `the units the ship moved in the ${String(COAST_SECONDS)}s after the ` +
      "direction was released, with no key down — the ship stops in the frame " +
      "its direction is released, with no drift and no inertia (specs/ship.md)",
  );
});
