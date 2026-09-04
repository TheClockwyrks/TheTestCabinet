// bands/shield-absorbs — the hull absorbs an enemy bullet of the ship's own band.
//
// specs/bands.md makes the ship's current band its hull's shield: "The same band
// as the ship's | The bullet is absorbed and leaves the roster, and the ship is
// unharmed." specs/progression.md agrees from the other side — an enemy bullet of
// the ship's own band reaching the ship costs nothing.
//
// The ship is posed on cyan by `startPosed`, its contact test — one of the three
// world gates that pose shuts — is turned back ON, since it is precisely this
// item's requirement, and one cyan enemy bullet is dropped onto it. Nothing else
// is on the field: no drone, no other bullet, so the only thing that can move the
// life count is the contact under test.
//
// Both halves the review item states are read: no life is paid, and the bullet
// leaves the roster. The opposite band is the sibling
// `bands/shield-opposite-lethal`, so a hull that absorbs everything and a hull
// that absorbs nothing grade differently.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { START_LIVES } from "../constants";
import {
  bulletById,
  captureStill,
  createHarness,
  fireAtShip,
  startPosed,
  type Harness,
} from "../harness";

/**
 * How far above the ship the enemy bullet is placed, in logical units.
 *
 * The hull's contact reach against an enemy bullet is `SHIP_HALF` (15) +
 * `ENEMY_BULLET_HALF` (8) = 23 units of centre separation, so 120 starts the
 * bullet five times clear of it and the contact is one the fall produced.
 */
const DROP_ABOVE = 120;

/**
 * Frames the fall is allowed.
 *
 * An enemy bullet falls at `ENEMY_BULLET_SPEED` (320) times
 * `bulletSpeedScale(1)` (1) — 3.2 units per frame of the harness's 100 Hz clock —
 * so it enters the hull's reach 97 units down, inside 31 frames. Forty-five
 * leaves fourteen frames of slack and still ends the sweep with the bullet at
 * y = 624, above `FIELD_BOTTOM` (656): inside this sweep a bullet cannot leave the
 * roster by falling off the field, so leaving it means the hull took it.
 */
const DROP_FRAMES = 45;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("costs no life and takes the same-band bullet off the roster", async () => {
  await startPosed(harness);
  await harness.debug.setShipContact(true);
  const posed = await harness.snapshot();
  assertEqual(posed.ship.band, "cyan", "the band the ship was posed on");
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  const shot = await fireAtShip(harness, "cyan", {
    above: DROP_ABOVE,
    maxFrames: DROP_FRAMES,
  });
  await captureStill(harness, "absorbed");

  assertEqual(
    shot.snapshot.lives,
    START_LIVES,
    "the lives left after a bullet of the ship's own band reached the hull (specs/bands.md)",
  );
  assertUndefined(
    bulletById(shot.snapshot, shot.id),
    "the same-band bullet, absorbed and off the roster (specs/bands.md)",
  );
});
