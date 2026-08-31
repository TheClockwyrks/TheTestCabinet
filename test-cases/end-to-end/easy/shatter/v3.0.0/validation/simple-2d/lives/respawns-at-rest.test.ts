// lives/respawns-at-rest — the next ship starts still, whatever the last one was
// doing.
//
// THE RULE. `specs/progression.md`: "the next ship appears AT REST at the safe
// point". `specs/ship.md` says the same of a life beginning. The position and the
// facing are their own items; this one reads the SPEED alone.
//
// THE SHIP DIES CARRYING REAL MOMENTUM, which is the whole of what makes this
// decidable. The ship flies up the field at `CARRIED_SPEED` into a Small posed at
// rest above it, so it is destroyed at some `283` units per second — the drag
// `specs/ship.md` fixes has bled a little off it by then, and the well never pulls
// the ship at all. Every wrong model then reads as a different number: a build
// that carries the wreck's velocity onto the next ship reads `283`, a build that
// halves it reads `142`, and a build that places the next ship at rest, as the
// specification requires, reads `0`.
//
// A CHECK THAT KILLED A MOTIONLESS SHIP WOULD GRADE NOTHING. It would read `0`
// from a build that copied the wreck's velocity and `0` from a build that cleared
// it, which is the shape of a check whose setup smuggles the answer in. The pose
// is read back before the scenario runs (`./scene.ts`), so a build that ignored
// `setShipVelocity` fails with that named rather than passing on a ship that was
// never moving.
//
// WHY ONE UNIT PER SECOND. "At rest" is exactly zero, and the next ship is PLACED
// rather than flown, so the tolerance is float slack on a placement. It is a
// three-hundredth of the momentum the dying ship carried and a six-hundred-and-
// eightieth of `SHIP_MAX`, so no build that keeps any part of the wreck's motion
// survives it.
//
// WHY THE FIELD IS EMPTIED BEFORE THE READING. `settleRespawn` clears the rock
// through `clearRocks`, which destroys nothing and scores nothing
// (`specs/instrumentation.md`), so the ship this reads is standing on an empty
// field and nothing but the respawn decided its velocity.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_MAX } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  speedOf,
  startPlaying,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
  contactNeeded,
  settleRespawn,
  untilLifeLost,
} from "./scene";

/**
 * The speed the dying ship carries, in units per second.
 *
 * Well inside `SHIP_MAX` (`680`), so the speed cap `specs/ship.md` fixes never
 * enters, and far enough above zero that a build carrying any fraction of it onto
 * the next ship reads a number nothing like `0`.
 */
const CARRIED_SPEED = 300;

/** How fast the next ship may be moving and still be "at rest", in units/second. */
const REST_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the next ship up at rest, though the last one died at speed", async () => {
  startPlaying(h);
  const before = h.snapshot().lives;
  // The ship flies up into a Small standing still, so the closing is the SHIP's.
  arrangeDoomedShip(h, { shipSpeed: CARRIED_SPEED, rockDrift: 0 });

  const lost = await untilLifeLost(h, before);
  assertEqual(
    lost.hit,
    true,
    contactNeeded(
      "a ship flying into a standing Small",
      APPROACH_GAP,
      SHIP_TOUCHES_SMALL,
      CARRIED_SPEED,
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
    speedOf(settled.ship),
    REST_TOLERANCE,
    `the speed of the next ship, which appears at rest — the one it replaced ` +
      `was destroyed flying at some ${CARRIED_SPEED} units per second, a ` +
      `${(CARRIED_SPEED / SHIP_MAX).toFixed(2)} of the cap (specs/progression.md)`,
  );
});
