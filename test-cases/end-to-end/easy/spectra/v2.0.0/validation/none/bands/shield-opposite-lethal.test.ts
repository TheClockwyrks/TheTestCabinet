// bands/shield-opposite-lethal — an enemy bullet of the opposite band costs a life.
//
// specs/bands.md: "The opposite band | The ship is hit, and the bullet leaves the
// roster", and specs/progression.md prices it: "One event costs exactly one life,
// whatever else is on the field at that instant."
//
// The scenario is `bands/shield-absorbs` with one value changed — the bullet's
// band — so the two items together decide whether the hull filters or merely
// waves everything through. The ship is on cyan, the bullet is magenta, its
// contact gate is on, and nothing else is on the field, so the life count can
// only move for the reason under test.
//
// The reading is the life count and nothing else: EXACTLY one life, so a build
// that charges the hit twice fails as loudly as one that charges it not at all.
// Whether the bullet also leaves the roster is not read here — that direction is
// the sibling's, and a build that hits correctly but keeps its bullet should not
// fail the hit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  fireAtShip,
  startPosed,
  type Harness,
} from "../harness";

/**
 * How far above the ship the enemy bullet is placed, in logical units.
 *
 * Five times the hull's 23-unit contact reach against an enemy bullet
 * (`SHIP_HALF` 15 + `ENEMY_BULLET_HALF` 8), so the bullet falls into the ship
 * rather than being placed on top of it.
 */
const DROP_ABOVE = 120;

/**
 * Frames the fall is allowed.
 *
 * At `ENEMY_BULLET_SPEED` (320) times `bulletSpeedScale(1)` (1) the bullet covers
 * 3.2 units per frame of the harness's 100 Hz clock and reaches the hull inside
 * 31; forty-five leaves the contact fourteen frames of slack to resolve in.
 */
const DROP_FRAMES = 45;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("costs exactly one life when the opposite-band bullet reaches the hull", async () => {
  await startPosed(harness);
  await harness.debug.setShipContact(true);
  const posed = await harness.snapshot();
  assertEqual(posed.ship.band, "cyan", "the band the ship was posed on");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  const shot = await fireAtShip(harness, "magenta", {
    above: DROP_ABOVE,
    maxFrames: DROP_FRAMES,
  });
  await captureStill(harness, "hit");

  assertEqual(
    shot.snapshot.lives,
    START_LIVES - 1,
    "the lives left after one bullet of the band opposite the ship's reached it (specs/bands.md, specs/progression.md)",
  );
});
