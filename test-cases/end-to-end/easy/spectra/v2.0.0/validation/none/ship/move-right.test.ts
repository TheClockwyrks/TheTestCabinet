// Spectra — ship/move-right: holding right carries the ship SHIP_SPEED units
// right in a second.
//
// THE RULE. `specs/ship.md`: the ship "moves left and right only, along the lane
// `specs/field.md` fixes", and "it travels at `SHIP_SPEED` (`360`) units per
// second while a direction is held". This point decides that figure in the RIGHT
// direction; `ship/move-left` decides it in the other, so a build whose right
// control is broken and whose left one is not loses exactly one point. The two
// are graded apart because a build can very easily get one sign right and the
// other wrong.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. The DISPLACEMENT one held second produced,
// against `SHIP_SPEED * 1 s`, within the review item's 5%. Which physical keys
// are wired to the `right` action is `controls/right-arrow`'s and
// `controls/key-d`'s point, and this check drives the first of the two keys
// `specs/controls.md` binds rather than restating that binding.
//
// WHY THE HOLD IS MEASURED WHERE IT IS. `startPosed` parks the ship at the centre
// of its lane, `FORM_CENTER_X` (640). A second of travel at the stated rate ends
// at 1000 — 240 units clear of `SHIP_X_MAX` (1240), so the lane's clamp never
// enters this scenario and the reading is the rate alone. The clamp is
// `ship/clamp-right`'s point.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no drone arrives, none dives, and no contact drops the ship
// into the `ready` phase — where `specs/progression.md` re-centres it — while the
// key is held.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { BINDINGS, FORM_CENTER_X, SHIP_SPEED, SHIP_X_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The key the hold is delivered on: the first `specs/controls.md` binds to
 * `right`.
 */
const RIGHT_KEY = BINDINGS.right[0];

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
 * running at any other plausible rate does not. The bound is two-sided on
 * purpose: a ship that overshoots the figure is as wrong as one that falls short.
 */
const TRAVEL_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the ship SHIP_SPEED units right over a held second", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertEqual(before.ship.x, FORM_CENTER_X, "the ship starts mid-lane");

  await h.holdFor(RIGHT_KEY, HOLD_FRAMES);
  await captureStill(h, "moved");
  const after = await h.snapshot();

  assertBetween(
    after.ship.x - before.ship.x,
    EXPECTED_TRAVEL * (1 - TRAVEL_TOLERANCE),
    EXPECTED_TRAVEL * (1 + TRAVEL_TOLERANCE),
    `the units a ${HOLD_SECONDS}s hold carried the ship RIGHT, at SHIP_SPEED (${SHIP_SPEED}) and clear of SHIP_X_MAX (${SHIP_X_MAX}) throughout (specs/ship.md)`,
  );
});
