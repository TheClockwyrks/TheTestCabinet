// ship/bullet-spawn-point — a shot leaves the ship's own nose.
//
// specs/ship.md, "Firing": a shot "appears centered on the ship's own center `x`,
// above `SHIP_Y`, at the nose of the hull". The review item states the reading: the
// shot's centre sits within 4 units of the ship's centre `x`, and above `SHIP_Y`.
//
// THE SHIP IS DRIVEN OFF THE LANE CENTRE FIRST, and that is the whole design of this
// check. "The ship's own centre `x`" and "the middle of the lane" are the same number
// at `startPosed`'s resting position (640), so a build that spawns its shots at a
// fixed x — the lane's centre, or the stage's — would agree with a correct build
// there and pass on a coincidence. Posed at 430 the two models read as two numbers
// 210 units apart, which is fifty times the tolerance: a failure names WHICH model
// the build implemented rather than only that something is off.
//
// 430 IS ORDINARY GROUND. It is 390 units inside `SHIP_X_MIN` and 810 inside
// `SHIP_X_MAX`, so no bound is near enough to move the ship or the shot, and it is
// not the value of any figure the specification fixes, so it cannot be matched by
// accident.
//
// THE SHOT IS READ ON THE FIRST FRAME IT EXISTS. `fireOneShot` runs the press one
// frame at a time and returns the bullet the moment it reaches the roster, so what
// is read is the spawn rather than a position the climb has carried away.
// `PLAYER_BULLET_SPEED` still moves it up by one frame's worth inside the frame it
// is born in — the fire and the bullets' motion resolve in the same sub-step
// (specs/simulation.md) — which is 7.6 units of the 22 the nose already sits above
// `SHIP_Y`, and is why "above `SHIP_Y`" is read as the bound the item states rather
// than as an exact height. That one frame makes the vertical reading slightly
// generous to the build and cannot make it strict.
//
// THE HORIZONTAL READING IS UNAFFECTED, because a player bullet travels straight up:
// nothing in `specs/ship.md` gives it any horizontal velocity, so its `x` on the
// frame it is read is its `x` at the spawn whatever the frame cost.
//
// WHAT IS NOT DECIDED HERE. That the press adds exactly one bullet
// (`ship/fire-spawns-bullet`), how fast it climbs (`ship/bullet-travels-up`), and
// what band it carries (`ship/bullet-carries-band`).

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_X_MAX, SHIP_X_MIN, SHIP_Y } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  LANE_CENTER,
  startPosed,
  type Harness,
} from "../harness";
import { fireOneShot } from "./cannon";

/**
 * Where the ship stands when it fires: off the centre of its own lane.
 *
 * Chosen so that "the ship's centre" and "the middle of the lane" are 210 units
 * apart, and so that neither bound of the lane is anywhere near: 390 units inside
 * `SHIP_X_MIN` (40) and 810 inside `SHIP_X_MAX` (1240).
 */
const SHIP_AT = 430;

/** The review item's own tolerance on the shot's centre `x`, in logical units. */
const SPAWN_X_TOLERANCE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the shot at the ship's own centre x, above SHIP_Y", async () => {
  startPosed(h);
  h.debug.setShipX(SHIP_AT);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the fire action");
  assertEqual(
    before.ship.x,
    SHIP_AT,
    "the ship placed off the centre of its lane, well inside both bounds and " +
      "so not itself clamped (specs/instrumentation.md)",
  );
  assertGreaterThan(
    Math.min(before.ship.x - SHIP_X_MIN, SHIP_X_MAX - before.ship.x),
    SPAWN_X_TOLERANCE,
    "the units of lane on either side of the ship, so no bound is near enough " +
      "to move the shot",
  );

  const shot = await fireOneShot(h, "the shot whose spawn point is read");
  // Before the assertions, so a check that fails still leaves the picture of where
  // the build put the shot.
  captureStill(h, "nose");

  assertLessThanOrEqual(
    Math.abs(shot.x - SHIP_AT),
    SPAWN_X_TOLERANCE,
    `how far the shot's centre x (${String(shot.x)}) sat from the ship's own ` +
      `centre x (${String(SHIP_AT)}), which is ` +
      `${String(Math.abs(SHIP_AT - LANE_CENTER))} units from the middle of the ` +
      "lane (specs/ship.md)",
  );
  assertLessThan(
    shot.y,
    SHIP_Y,
    `the shot's centre y on the frame it appeared — a shot leaves the ship's ` +
      `nose, ABOVE SHIP_Y (${String(SHIP_Y)}), and y grows downward ` +
      "(specs/ship.md, specs/overview.md)",
  );
});
