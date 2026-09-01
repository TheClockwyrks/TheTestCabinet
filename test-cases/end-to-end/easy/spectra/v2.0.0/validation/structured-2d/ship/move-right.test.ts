// ship/move-right — a held right moves the ship right at `SHIP_SPEED`.
//
// specs/ship.md, "Movement": "The ship moves left and right only, along the lane
// specs/field.md fixes. It travels at `SHIP_SPEED` (`360`) units per second while a
// direction is held." This point decides the RIGHT half of that, and only the right
// half: `ship/move-left` owns the other, so a build that wired one direction and
// not the other loses exactly the one it missed rather than the pair.
//
// THE REVIEW ITEM'S TOLERANCE IS 5% of the ground a second covers, which is 18
// units. Wide enough for a build that integrates the ship's travel a sub-step at a
// time (specs/simulation.md) and so lands a fraction of a unit off a whole second's
// worth, and far too narrow to admit a build travelling at half or twice the stated
// speed.
//
// THE KEY IS HELD FOR THE WHOLE SECOND, on the REAL registered-action path:
// `specs/controls.md` reads `right` as a hold, and `holdActionFor` puts the first
// key that table binds it to down at the engine's own event target and leaves it
// there for exactly the frames the measurement covers. Which keys move the ship
// right is `controls/right-arrow` and `controls/key-d`; here the binding is only the
// way in, so the case's own table is read rather than a literal written out.
//
// THE CLAMP TAKES NO PART. `startPosed` parks the ship at the centre of its lane,
// which leaves 600 units of room before `SHIP_X_MAX` — well over the 378 a build at
// the top of the tolerance would cover — and the check asserts that headroom before
// it measures anything, so what is read is a second of free travel rather than a
// ship resting on a bound. `ship/clamp-right` is what decides the bound.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so nothing arrives
// to cost a life mid-measurement and put the ship into the `ready` phase, where
// specs/progression.md would return it to the centre of its lane and ruin the
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_SPEED, SHIP_X_MAX } from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  holdActionFor,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The review item's tolerance on the ground a held second covers: within 5%. */
const SPEED_TOLERANCE = 0.05;

/** The second the point is stated over, in frames of the harness's 100 Hz clock. */
const HELD_SECONDS = 1;
const HELD_FRAMES = ticksFor(HELD_SECONDS);

/**
 * The room the ship must have before `SHIP_X_MAX` for the second to be free travel.
 *
 * Not a reading of the build: a precondition on the SCENARIO, asserted against the
 * position `startPosed` left the ship at. A build at the fast end of the tolerance
 * covers `SHIP_SPEED * 1.05`, so anything past that cannot meet the lane's bound
 * inside the window and the clamp cannot flatter or spoil the measurement.
 */
const HEADROOM_MIN = SHIP_SPEED * HELD_SECONDS * (1 + SPEED_TOLERANCE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the ship SHIP_SPEED units right over a held second", async () => {
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
  assertGreaterThan(
    SHIP_X_MAX - before.ship.x,
    HEADROOM_MIN,
    "the units of lane between the ship and SHIP_X_MAX before the hold, so " +
      "the clamp cannot bind inside the measured second",
  );

  await holdActionFor(h, "right", HELD_FRAMES);
  // Before the assertion, so a check that fails still leaves the picture of where
  // the held second put the ship.
  captureStill(h, "moved");

  const travelled = h.snapshot().ship.x - before.ship.x;
  assertBetween(
    travelled,
    SHIP_SPEED * HELD_SECONDS * (1 - SPEED_TOLERANCE),
    SHIP_SPEED * HELD_SECONDS * (1 + SPEED_TOLERANCE),
    `the units the ship travelled RIGHT over ${String(HELD_SECONDS)}s of held ` +
      `right, SHIP_SPEED (${String(SHIP_SPEED)}) within ` +
      `${String(SPEED_TOLERANCE * 100)}% (specs/ship.md)`,
  );
});
