// Spectra — ship/move-left: holding left carries the ship SHIP_SPEED units left
// in a second.
//
// THE RULE. `specs/ship.md`: the ship "moves left and right only, along the lane
// `specs/field.md` fixes", and "it travels at `SHIP_SPEED` (`360`) units per
// second while a direction is held". This point decides that figure in the LEFT
// direction; `ship/move-right` decides it in the other, so a build whose left
// control is broken and whose right one is not loses exactly one point.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. The DISPLACEMENT one held second produced,
// against `SHIP_SPEED * 1 s`, within the review item's 5%. Which physical keys
// are wired to the `left` action is `controls/left-arrow`'s and
// `controls/key-a`'s point, and this check drives the first of the two keys
// `specs/controls.md` binds rather than restating that binding: a build that
// wired neither key loses those points, and this one, because a ship no key can
// move does not travel at `SHIP_SPEED` either.
//
// WHY THE HOLD IS MEASURED WHERE IT IS. `startPosed` parks the ship at the centre
// of its lane, `FORM_CENTER_X` (640). A second of travel at the stated rate ends
// at 280 — 240 units clear of `SHIP_X_MIN` (40), so the lane's clamp never enters
// this scenario and the reading is the rate alone. The clamp is
// `ship/clamp-left`'s point, and a check that started closer to the bound would
// be grading it here as well.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no drone arrives, none dives, and no contact drops the ship
// into the `ready` phase — where `specs/progression.md` re-centres it — while the
// key is held. The only thing on the field that can move the ship is the key.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { BINDINGS, FORM_CENTER_X, SHIP_SPEED, SHIP_X_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/** The key the hold is delivered on: the first `specs/controls.md` binds to `left`. */
const LEFT_KEY = BINDINGS.left[0];

/** The second the review item names, in frames of this harness's 100 Hz clock. */
const HOLD_SECONDS = 1;
const HOLD_FRAMES = framesFor(HOLD_SECONDS);

/** What `specs/ship.md` says that second covers: `SHIP_SPEED` units. */
const EXPECTED_TRAVEL = SHIP_SPEED * HOLD_SECONDS;

/**
 * The review item's tolerance on that travel: within 5%.
 *
 * 18 units, which is five frames of this clock's travel (3.6 units each), so a
 * build that starts or stops the hold a frame or two late still passes, and one
 * running at any other plausible rate — half, double, 60 units a frame — does
 * not. The bound is two-sided on purpose: a ship that overshoots the figure is
 * as wrong as one that falls short.
 */
const TRAVEL_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the ship SHIP_SPEED units left over a held second", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertEqual(before.ship.x, FORM_CENTER_X, "the ship starts mid-lane");

  await h.holdFor(LEFT_KEY, HOLD_FRAMES);
  await captureStill(h, "moved");
  const after = await h.snapshot();

  assertBetween(
    before.ship.x - after.ship.x,
    EXPECTED_TRAVEL * (1 - TRAVEL_TOLERANCE),
    EXPECTED_TRAVEL * (1 + TRAVEL_TOLERANCE),
    `the units a ${HOLD_SECONDS}s hold carried the ship LEFT, at SHIP_SPEED (${SHIP_SPEED}) and clear of SHIP_X_MIN (${SHIP_X_MIN}) throughout (specs/ship.md)`,
  );
});
