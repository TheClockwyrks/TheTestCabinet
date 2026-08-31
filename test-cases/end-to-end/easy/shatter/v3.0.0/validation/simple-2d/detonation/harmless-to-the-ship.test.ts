// detonation/harmless-to-the-ship — a torpedo passes through its own ship.
//
// `specs/collision.md` pairs a torpedo with the ship and resolves it to "Nothing.
// The torpedo passes through the ship, which is unharmed, and stays in flight." It
// is the only body on the field a torpedo neither destroys nor is stopped by: it
// destroys a rock and the saucer, and the core absorbs it.
//
// THE SHIP'S CONTACT GATE IS TURNED BACK ON, which is unusual in this project and
// is the whole point of the item. `startPlaying` shuts it, because a rock a check
// poses near the ship would otherwise cost a life mid-scenario; here the lethal
// contact test IS the requirement, so it is switched on and its being on is
// asserted before a tick runs. `specs/instrumentation.md` gates exactly that test
// and nothing else, and the respawn grace is separately at zero, so if anything at
// all could destroy the ship on this pass, it would.
//
// THE PASS IS PROVEN, NOT ASSUMED. A build that steered the torpedo around the
// ship, or one whose contact test simply never fires, would both leave the ship
// whole; what separates them is whether the two bodies were ever in contact. So
// every tick of the flight is sampled and the closest the torpedo's PATH came to
// the ship's centre is read — the distance to the segment between two samples, not
// to the samples, since the closest point of a path lies between them (fold-in fix
// B, `geometry.ts`'s `distanceToSegment`) — and that closest approach must be
// inside `SHIP_R + TORPEDO_R` (20), which is contact as `specs/collision.md`
// defines it.
//
// THE SHIP IS UNHARMED IS READ TWO WAYS, because one alone is weak. Its lives
// still stand at `START_LIVES` (`specs/progression.md` loses one on a
// destruction), and it carries no respawn grace — `INVULN_TIME` is what a fresh
// ship carries, so a zero says no ship was ever destroyed and replaced.
//
// NEITHER BODY IS PULLED. `specs/gravity.md` exempts both the ship and the torpedo
// from the well, so a ship posed at rest holds its place and the torpedo holds its
// line: the pass is the arrangement's and nothing the environment did. The ship is
// still read fresh on every tick, so a build that does pull it is measured against
// where it actually was rather than where it was put.
//
// ITS GUIDANCE IS OFF, so the torpedo cannot turn: the line it was launched on is
// the line it flies, and there is nothing on the field for it to acquire anyway.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_R, START_LIVES, TORPEDO_R } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import { distanceToSegment, type Point } from "../geometry";
import {
  captureStill,
  createHarness,
  poseTorpedo,
  startPlaying,
  ticksFor,
  torpedoById,
  torpedoesOf,
  type Harness,
} from "../harness";
import { QUIET_GROUND, holdItsHeading } from "./scenario";

/** How far upstream of the ship the torpedo starts, in logical units. */
const RUN_UP = 120;

/** How far past the ship's centre it is flown before the reading is taken. */
const RUN_OUT = 60;

/** The line it travels along: straight along `+x`, through the ship's centre. */
const SHOT_HEADING = 0;

/** Contact, as `specs/collision.md` defines it for these two bodies. */
const CONTACT = SHIP_R + TORPEDO_R;

/**
 * The ceiling on the sweep.
 *
 * The flight is `RUN_UP + RUN_OUT` (180) units at `TORPEDO_SPEED`, a little over
 * fifty ticks; a second bounds a build whose torpedo does not travel without
 * hanging the suite, and stays well inside `TORPEDO_LIFE` (3.5 s) so the lifetime
 * cannot be what ends the flight.
 */
const MAX_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flies through the ship with its contact gate on, harming neither", async () => {
  startPlaying(h);
  h.debug.setShipPosition(QUIET_GROUND.x, QUIET_GROUND.y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipInvuln(0);
  h.debug.setShipCollision(true);

  const armed = h.snapshot();
  assertEqual(
    armed.ship.collision,
    true,
    "the ship's lethal contact test running for the pass " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    armed.ship.invuln,
    0,
    "the ship carrying no respawn grace for the pass (specs/progression.md)",
  );

  const torpedoId = poseTorpedo(
    h,
    QUIET_GROUND.x - RUN_UP,
    QUIET_GROUND.y,
    SHOT_HEADING,
  );
  holdItsHeading(h, torpedoId);

  const launched = torpedoById(
    h.snapshot(),
    torpedoId,
    "the torpedo launched at the ship",
  );
  let previous: Point = { x: launched.x, y: launched.y };
  let closest = Number.POSITIVE_INFINITY;
  let inFlight = true;
  let cleared = false;
  let captured = false;
  let final = armed;

  for (let tick = 0; tick < MAX_TICKS && inFlight && !cleared; tick += 1) {
    await h.advance(1);
    final = h.snapshot();
    const torpedo = torpedoesOf(final).find((t) => t.id === torpedoId);
    if (torpedo === undefined) {
      inFlight = false;
      break;
    }
    const at = { x: torpedo.x, y: torpedo.y };
    const ship = { x: final.ship.x, y: final.ship.y };
    closest = Math.min(closest, distanceToSegment(ship, previous, at));
    previous = at;
    // Kept the moment the torpedo first stands over the ship, which is the
    // picture the review item asks for.
    if (!captured && at.x >= ship.x) {
      captureStill(h, "passthrough");
      captured = true;
    }
    if (at.x >= ship.x + RUN_OUT) cleared = true;
  }
  if (!captured) captureStill(h, "passthrough");

  assertTrue(
    inFlight,
    "the torpedo still in flight after crossing the ship (specs/collision.md)",
  );
  assertTrue(
    cleared,
    `the torpedo carried ${RUN_OUT} units past the ship within a second ` +
      "(specs/weapons.md)",
  );
  assertLessThanOrEqual(
    closest,
    CONTACT,
    "the torpedo's path really reaching the ship, within SHIP_R + TORPEDO_R " +
      "(specs/collision.md)",
  );
  assertEqual(
    final.lives,
    START_LIVES,
    "the ship costing no life to the torpedo that crossed it " +
      "(specs/collision.md)",
  );
  assertEqual(
    final.ship.invuln,
    0,
    "the ship carrying no fresh respawn grace, so none was destroyed " +
      "(specs/progression.md)",
  );
});
