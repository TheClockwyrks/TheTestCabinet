// Spectra — controls/right-arrow: holding `ArrowRight` moves the ship right.
//
// THE RULE. `specs/controls.md` binds the `right` action to the two keys
// `ArrowRight` and `KeyD`, reads `right` as a HOLD rather than a press edge, and
// lists it among the actions the `inWave` screen reads. `specs/ship.md` says the
// ship travels right along its lane while that direction is held. This point decides
// one half of the binding: that the physical key `ArrowRight` is one of the keys which
// drives it. `KeyD` is the alternate and `controls/key-d` decides it, so a
// build that wired one and not the other loses exactly one point rather than two.
//
// THE KEY IS A REAL ONE, AND THE BINDING IS THE CASE'S. Under this engine input
// reaches the game as named actions: the build registers `ACTIONS` against the keys
// `BINDINGS` gives them, and the engine owns the listening, the resolving and the
// edges (`specs/controls.md`, and the engine's own `engine/input.md`). `holdFor`
// dispatches a `KeyboardEvent`-shaped event at the engine's own event target, which
// the engine resolves exactly as it resolves a player's key, so the whole path from
// a physical key to a moving ship — the registration included — is exercised here.
// The code below is the LITERAL `specs/controls.md` states rather than
// `BINDINGS.right[…]`: that table is the build's own copy of the very thing this point
// decides, and reading it would let a build which bound the wrong key agree with
// itself and pass.
//
// IT IS HELD, NOT TAPPED. `specs/controls.md` reads `right` as a hold, so a
// conforming build resolves it through the engine's `value` rather than its
// `pressed`. A key pressed and released inside one frame leaves the action at rest
// for the whole of that frame's update, so the key goes down and stays down for the
// window below, which is what a player pressing it does.
//
// THE DIRECTION IS THE POINT, NOT THE RATE. `SHIP_SPEED` is graded once, by
// `ship/move-right`; asserting the figure here as well would cost one build two
// points for one fault. What is required of the displacement is that it is real and
// that it is rightward, which is why the bound below is a small fraction of the
// stated travel rather than the travel itself: a check that demanded the whole
// figure inside a fixed window would be quietly grading the speed.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no drone arrives, none dives and no contact ends the run while the
// key is held. The only thing on the field that can move the ship is the key.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_SPEED } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  LANE_CENTER,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds the `right` action to, written out as it states it. */
const KEY = "ArrowRight";

/** How long the key is held down. */
const HOLD_SECONDS = 0.4;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

/**
 * What `specs/ship.md` says that hold covers: `SHIP_SPEED` (`360`) units per second
 * for 0.4 s, so 144 units. `startPosed` parks the ship at the centre of its lane
 * (`LANE_CENTER`, 640), so a conformant build ends near 784 — clear of `SHIP_X_MAX` (`1240`), and the lane's
 * clamp never enters this scenario.
 */
const NOMINAL_TRAVEL = SHIP_SPEED * HOLD_SECONDS;

/**
 * How far right the ship must have travelled for this key to count as wired.
 *
 * A QUARTER of the stated travel, deliberately far below it. The rate belongs to
 * `ship/move-right`; all this point asks is that the key moved the ship, and moved
 * it RIGHT. A build travelling at any plausible fraction of the stated speed clears
 * this bound, and a build whose `ArrowRight` does nothing — or drives the ship the other
 * way — does not.
 */
const MIN_TRAVEL = NOMINAL_TRAVEL / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the ship right while the Right arrow is held", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertEqual(before.ship.x, LANE_CENTER, "the ship starts mid-lane");

  await holdFor(h, KEY, HOLD_TICKS);
  // Before the assertion, so a check that fails still leaves the picture that
  // shows where the ship ended up.
  captureStill(h, "moved");

  assertGreaterThan(
    h.snapshot().ship.x,
    before.ship.x + MIN_TRAVEL,
    `the ship's centre after the Right arrow was held for ${String(HOLD_SECONDS)}s from ` +
      `${String(before.ship.x)}, which must have carried it at least ` +
      `${String(MIN_TRAVEL)} units right (specs/controls.md, specs/ship.md)`,
  );
});
