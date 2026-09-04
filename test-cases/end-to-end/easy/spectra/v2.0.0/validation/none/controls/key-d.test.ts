// Spectra — controls/key-d: holding `KeyD` moves the ship right.
//
// THE RULE. `specs/controls.md` binds the `right` action to the two keys
// `ArrowRight` and `KeyD`, reads `right` as a HOLD rather than a press
// edge, and lists it among the actions the `inWave` screen reads.
// `specs/ship.md` says the ship travels right along its lane while that direction
// is held. This point decides one half of the binding: that the physical key
// `KeyD` is one of the keys which drives it. `ArrowRight` is the alternate and
// `controls/right-arrow` decides it, so a build that wired one and not the other loses
// exactly one point rather than two.
//
// THE KEY IS A REAL ONE. `holdFor` presses and releases through Chromium's own
// input pipeline, so what reaches the build is a browser-trusted DOM key event on
// the real page rather than a synthetic one posed at whatever target a runtime
// listens on. Under this engine there is no action layer between the page and the
// game — `specs/instrumentation.md` puts the keyboard in the runtime layer an
// engineless build writes, and gives the surface no keyboard operation at all —
// so the whole path from a physical key to a moving ship is the build's own, and
// all of it is exercised here.
//
// THE DIRECTION IS THE POINT, NOT THE RATE. `SHIP_SPEED` is graded once, by
// `ship/move-right`; asserting the figure here as well would cost one build two
// points for one fault. What is required of the displacement is that it is real
// and that it is rightward, which is why the bound below is a small fraction of the
// stated travel rather than the travel itself: a check that demanded the whole
// figure inside a fixed window would be quietly grading the speed.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no drone arrives, none dives and no contact ends the run while
// the key is held. The only thing on the field that can move the ship is the key.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FORM_CENTER_X, SHIP_SPEED } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/** How long the key is held down. */
const HOLD_SECONDS = 0.4;
const HOLD_FRAMES = framesFor(HOLD_SECONDS);

/**
 * What `specs/ship.md` says that hold covers: `SHIP_SPEED` (360) units per second
 * for 0.4 s, so 144 units. `startPosed` parks the ship at the centre of its
 * lane (`FORM_CENTER_X`, 640), so a conformant build ends near 784 — clear of
 * `SHIP_X_MAX` (1240), and the lane's clamp never enters this scenario.
 */
const NOMINAL_TRAVEL = SHIP_SPEED * HOLD_SECONDS;

/**
 * How far right the ship must have travelled for this key to count as wired.
 *
 * A QUARTER of the stated travel, deliberately far below it. The rate belongs to
 * `ship/move-right`; all this point asks is that the key moved the ship, and moved
 * it RIGHT. A build travelling at any plausible fraction of the stated speed
 * clears this bound, and a build whose `KeyD` does nothing — or drives the
 * ship left — does not.
 */
const MIN_TRAVEL = NOMINAL_TRAVEL / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the ship right while KeyD is held", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the key is pressed in is live",
  );
  assertEqual(before.ship.x, FORM_CENTER_X, "the ship starts mid-lane");

  await h.holdFor("KeyD", HOLD_FRAMES);
  await captureStill(h, "moved");

  assertGreaterThan(
    (await h.snapshot()).ship.x,
    before.ship.x + MIN_TRAVEL,
    `KeyD carried the ship at least ${MIN_TRAVEL} units right over ${HOLD_SECONDS}s`,
  );
});
