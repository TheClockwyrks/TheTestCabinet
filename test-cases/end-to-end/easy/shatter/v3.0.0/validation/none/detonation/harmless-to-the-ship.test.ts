// detonation/harmless-to-the-ship — a torpedo passes through its own ship.
//
// specs/collision.md pairs a torpedo with the ship and resolves it to "Nothing.
// The torpedo passes through the ship, which is unharmed, and stays in flight."
// It is the only body on the field a torpedo neither destroys nor is stopped by:
// it destroys a rock and the saucer, and the core absorbs it.
//
// THE SHIP'S CONTACT GATE IS TURNED BACK ON, which is unusual in this project and
// is the whole point of the item. `startPlaying` shuts it, because a rock a check
// poses near the ship would otherwise cost a life mid-scenario; here the lethal
// contact test IS the requirement, so it is switched on and its being on is
// asserted before a tick runs. specs/instrumentation.md gates exactly that test
// and nothing else, and the respawn grace is separately at zero, so if anything at
// all could destroy the ship on this pass, it would.
//
// THE PASS IS PROVEN, NOT ASSUMED. A build that steered the torpedo around the
// ship, or one whose contact test simply never fires, would both leave the ship
// whole; what separates them is whether the two bodies were ever in contact. So
// every tick of the flight is sampled and the closest the torpedo's PATH came to
// the ship's centre is read — the distance to the segment between two samples, not
// to the samples, since the closest point of a path lies between them — and that
// closest approach must be inside `SHIP_R + TORPEDO_R` (20), which is contact as
// specs/collision.md defines it.
//
// THE SHIP IS UNHARMED IS READ TWO WAYS, because one alone is weak. Its lives
// still stand at `START_LIVES` (specs/progression.md loses one on a destruction),
// and it carries no respawn grace — `INVULN_TIME` is what a fresh ship carries, so
// a zero says no ship was ever destroyed and replaced.
//
// IT RUNS ON QUIET GROUND so the well cannot move the ship out of the torpedo's
// line: at `412` units out the pull is about `26` units per second squared, which
// over the half-second of this pass carries the ship some three units against a
// contact distance of twenty.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import { SHIP_R, START_LIVES, TORPEDO_R } from "../constants";
import { segmentDistance, type Vec } from "../geometry";
import {
  captureStill,
  centreOf,
  createHarness,
  poseTorpedo,
  requireTorpedo,
  startPlaying,
  ticksFor,
  torpedoById,
  type Harness,
} from "../harness";
import { QUIET_GROUND } from "./scenario";

/** How far upstream of the ship the torpedo starts, in logical units. */
const RUN_UP = 120;

/** How far past the ship's centre it is flown before the reading is taken. */
const RUN_OUT = 60;

/** The line it travels along: straight along `+x`, through the ship's centre. */
const SHOT_HEADING = 0;

/** Contact, as specs/collision.md defines it for these two bodies. */
const CONTACT = SHIP_R + TORPEDO_R;

/**
 * The ceiling on the sweep.
 *
 * The flight is `RUN_UP + RUN_OUT` (180) units at `TORPEDO_SPEED`, a little over
 * fifty ticks; a second bounds a build whose torpedo does not travel without
 * hanging the suite, and stays well inside `TORPEDO_LIFE` so the lifetime cannot
 * be what ends the flight.
 */
const MAX_TICKS = ticksFor(1);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("flies through the ship with its contact gate on, harming neither", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(QUIET_GROUND.x, QUIET_GROUND.y);
  await harness.debug.setShipVelocity(0, 0);
  await harness.debug.setShipInvuln(0);
  await harness.debug.setShipCollision(true);

  const armed = await harness.snapshot();
  assertEqual(
    armed.ship.collision,
    true,
    "the ship's lethal contact test running for the pass (specs/instrumentation.md)",
  );
  assertEqual(
    armed.ship.invuln,
    0,
    "the ship carrying no respawn grace for the pass (specs/progression.md)",
  );

  const torpedoId = await poseTorpedo(
    harness,
    QUIET_GROUND.x - RUN_UP,
    QUIET_GROUND.y,
    SHOT_HEADING,
    { homing: false },
  );

  let previous: Vec = centreOf(
    requireTorpedo(await harness.snapshot(), torpedoId, "harmless-to-the-ship"),
  );
  let closest = Number.POSITIVE_INFINITY;
  let inFlight = true;
  let cleared = false;
  let captured = false;
  let final = armed;

  for (let tick = 0; tick < MAX_TICKS && inFlight && !cleared; tick += 1) {
    await harness.advance(1);
    final = await harness.snapshot();
    const torpedo = torpedoById(final, torpedoId);
    if (torpedo === undefined) {
      inFlight = false;
      break;
    }
    const at = centreOf(torpedo);
    const ship = centreOf(final.ship);
    closest = Math.min(closest, segmentDistance(previous, at, ship));
    previous = at;
    // Kept the moment the torpedo first stands over the ship, which is the
    // picture the review item asks for.
    if (!captured && at.x >= ship.x) {
      await captureStill(harness, "passthrough");
      captured = true;
    }
    if (at.x >= ship.x + RUN_OUT) cleared = true;
  }
  if (!captured) await captureStill(harness, "passthrough");

  assertTrue(
    inFlight,
    "the torpedo still in flight after crossing the ship (specs/collision.md)",
  );
  assertTrue(
    cleared,
    `the torpedo carried ${RUN_OUT} units past the ship within a second (specs/weapons.md)`,
  );
  assertLessThanOrEqual(
    closest,
    CONTACT,
    "the torpedo's path really reaching the ship, within SHIP_R + TORPEDO_R (specs/collision.md)",
  );
  assertEqual(
    final.lives,
    START_LIVES,
    "the ship costing no life to the torpedo that crossed it (specs/collision.md)",
  );
  assertEqual(
    final.ship.invuln,
    0,
    "the ship carrying no fresh respawn grace, so none was destroyed (specs/progression.md)",
  );
});
