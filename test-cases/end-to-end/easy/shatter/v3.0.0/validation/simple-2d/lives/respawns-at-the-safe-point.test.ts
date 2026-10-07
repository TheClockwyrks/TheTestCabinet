// lives/respawns-at-the-safe-point — the next ship stands where a life begins.
//
// THE RULE. `specs/progression.md`: "When a ship is lost and lives remain, the next
// ship appears at rest at the safe point `(SAFE_X, SAFE_Y)` = `(640, 560)` facing
// `FACE_UP`". `specs/ship.md` fixes the same point as where a life begins,
// "directly below the star and clear of its core". Three properties are in that
// sentence and each is its own item, so a build that puts its next ship in the
// right place facing the wrong way loses one point rather than three: this one
// reads the POSITION alone.
//
// THE SHIP IS KILLED 444 UNITS FROM THE SAFE POINT, which is what makes the
// reading decide anything. `startPlaying` leaves the ship AT the safe point, so a
// check that killed it there would find it there afterwards whether a respawn
// happened or not; posing the death at `DEATH_SPOT` makes every wrong model read a
// different position. A build that leaves the wreck where it fell reads
// `(200, 620)`; a build that respawns at the field's centre reads `(640, 360)`; a
// build that respawns where the ship died reads the death spot.
//
// AND THE POSE IS READ BACK BEFORE THE SCENARIO RUNS (`./scene.ts`), so a build
// that ignored `setShipPosition` fails with that named rather than passing on a
// ship that was at the safe point the whole time.
//
// WHY ONE UNIT. `specs/progression.md` fixes the point exactly, as a pair of whole
// numbers, and nothing about a respawn is approximate — the ship is PLACED there
// rather than flown there. A unit is float slack on an exact placement, and it is
// a fourteenth of the ship's own collision radius, so no build that places its
// ship anywhere else survives it.
//
// WHAT THIS DOES NOT DECIDE. That the next ship is at rest (`respawns-at-rest`),
// that it faces up (`respawns-facing-up`), the grace it carries
// (`invuln-window`), or that one appears at all when the LAST ship is lost
// (`respawn-only-with-lives-left`, which requires that none does).

import { afterEach, beforeEach, it } from "vitest";
import { SAFE_X, SAFE_Y } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { distance } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  ROCK_DRIFT,
  SAFE_POINT,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
  centreOf,
  contactNeeded,
  settleRespawn,
  untilLifeLost,
} from "./scene";

/** How far off the exact safe point the next ship's centre may stand, in units. */
const PLACEMENT_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the next ship's centre at the safe point", async () => {
  startPlaying(h);
  const before = h.snapshot().lives;
  arrangeDoomedShip(h);

  const lost = await untilLifeLost(h, before);
  assertEqual(
    lost.hit,
    true,
    contactNeeded(
      "a drifting Small",
      APPROACH_GAP,
      SHIP_TOUCHES_SMALL,
      ROCK_DRIFT,
    ),
  );
  assertEqual(
    lost.snapshot.lives,
    before - 1,
    "the ships left after the contact, so a ship remains for the respawn this " +
      "item reads (specs/progression.md)",
  );

  const settled = await settleRespawn(h);
  captureStill(h, "respawn");

  assertLessThanOrEqual(
    distance(centreOf(settled.ship), SAFE_POINT),
    PLACEMENT_TOLERANCE,
    `how far the next ship's centre stands from the safe point ` +
      `(${SAFE_X}, ${SAFE_Y}); it was reported at ` +
      `(${settled.ship.x.toFixed(2)}, ${settled.ship.y.toFixed(2)}) ` +
      `(specs/progression.md)`,
  );
});
