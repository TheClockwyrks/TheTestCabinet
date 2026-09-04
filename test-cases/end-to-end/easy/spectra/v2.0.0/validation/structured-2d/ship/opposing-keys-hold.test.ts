// ship/opposing-keys-hold — both directions held at once leaves the ship still.
//
// specs/ship.md, Movement: "Holding both directions at once leaves the ship where
// it stands." It is written out because the general rule above it — the ship
// "travels at `SHIP_SPEED` (`360`) units per second while a direction is held" —
// does not decide it: with both held, both are held, and a build that adds the two
// requests, that takes whichever was pressed first, or that takes whichever its
// input layer reports last is each a consistent reading of that rule. Nothing else
// on the checklist presses two opposing keys: `ship/move-left`, `ship/move-right`,
// `ship/stops-on-release`, `ship/clamp-left` and `ship/clamp-right` each hold one
// direction, and `controls/left-arrow` and its siblings grade one binding at a
// time.
//
// THE SHIP IS POSED WELL INSIDE ITS LANE, so the clamp cannot answer for the rule.
// At `POSED_X` (500) the nearer bound, `SHIP_X_MIN` (40), is 460 units away and the
// further, `SHIP_X_MAX` (1240), is 740 — both more than the 360 units a whole
// second at `SHIP_SPEED` covers, so a build that drifts drifts freely and is read
// as drifting rather than stopped by a wall.
//
// THE FIRST BINDING OF EACH DIRECTION IS USED, because this point is about the
// ACTIONS rather than the keys: which keys `left` and `right` answer to is
// `controls`'s, and a build that has bound only one of the two spellings loses its
// points there rather than here.
//
// EVERY FRAME IS READ, NOT ONLY THE LAST. "Leaves the ship where it stands" is a
// claim about every instant of the hold, and a build that drifts one way and
// returns — or that jitters a unit a frame — ends where it began. The reading is
// the furthest the ship's centre ever got from where it was posed.
//
// THE TOLERANCE IS A ROUNDING ALLOWANCE, NOT A BEHAVIOUR ALLOWANCE. Half a logical
// unit is smaller than the pixel a 1280-wide stage draws at 1:1, and a seventh of
// the 3.6 units ONE frame of travel at `SHIP_SPEED` covers on this 100 Hz clock, so
// a build that moves the ship for even a single frame of the hold is outside it.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no drone arrives, none dives, and no contact drops the ship into
// the `ready` phase — where `specs/progression.md` re-centres it — while the keys
// are held.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_SPEED, SHIP_X_MAX, SHIP_X_MIN } from "../constants";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdAction,
  releaseAction,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The two directions, held through the engine's own input layer.
 *
 * `holdAction` presses the first key `specs/controls.md` binds each to, which is
 * what makes this point about the ACTIONS rather than the keys.
 */
const LEFT = "left" as const;
const RIGHT = "right" as const;

/** The second both keys are held for, in frames of this harness's 100 Hz clock. */
const HOLD_SECONDS = 1;
const HOLD_FRAMES = ticksFor(HOLD_SECONDS);

/**
 * Where the ship stands for the hold, in logical units.
 *
 * Well inside `[SHIP_X_MIN, SHIP_X_MAX]` (`[40, 1240]`) on both sides by more than
 * the `SHIP_SPEED * HOLD_SECONDS` (360) units a drifting build would cover, so
 * neither clamp can hold a drifting ship still and be mistaken for the rule.
 */
const POSED_X = 500;

/** How far the ship's centre may stray over the hold, in logical units. */
const STILL_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship where it stands while both directions are held", async () => {
  startPosed(h);
  h.debug.setShipX(POSED_X);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the keys are held in is live");
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertCloseTo(
    before.ship.x,
    POSED_X,
    0,
    `precondition: the ship stands where it was posed, clear of SHIP_X_MIN ` +
      `(${SHIP_X_MIN}) and SHIP_X_MAX (${SHIP_X_MAX}) by more than the ` +
      `${SHIP_SPEED * HOLD_SECONDS} units a drifting build would cover`,
  );

  let strayed = 0;
  holdAction(h, LEFT);
  holdAction(h, RIGHT);
  try {
    for (let frame = 0; frame < HOLD_FRAMES; frame += 1) {
      await h.advance(1);
      strayed = Math.max(strayed, Math.abs(h.snapshot().ship.x - POSED_X));
    }
    captureStill(h, "still");
  } finally {
    releaseAction(h, LEFT);
    releaseAction(h, RIGHT);
  }

  assertLessThanOrEqual(
    strayed,
    STILL_TOLERANCE,
    `the furthest the ship's centre ever got from ${POSED_X} over a ` +
      `${HOLD_SECONDS}s hold of BOTH directions at once — it stays where it ` +
      `stands, and one frame of travel at SHIP_SPEED (${SHIP_SPEED}) on this ` +
      `100 Hz clock is ${(SHIP_SPEED / 100).toFixed(1)} units (specs/ship.md)`,
  );
});
