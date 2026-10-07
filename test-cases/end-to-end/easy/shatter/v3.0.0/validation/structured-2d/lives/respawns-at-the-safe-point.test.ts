// lives/respawns-at-the-safe-point — the ship a death puts up stands at the safe
// point.
//
// THE RULE. `specs/progression.md`: "When a ship is lost and lives remain, the
// next ship appears at rest at the safe point `(SAFE_X, SAFE_Y)` = `(640, 560)`
// facing `FACE_UP`". `specs/ship.md` names the same place. Three properties are
// stated there and each is its own item, so a build that respawns in the right
// place facing the wrong way loses one point rather than three. This one decides
// the PLACE.
//
// THE SHIP DIES 481 UNITS AWAY, which is what makes the reading mean anything.
// `startPlaying` poses the ship AT the safe point, so a death fought there would
// report the right answer on a build that never moved the ship at all. `duel.ts`
// fights at `(300, 180)` instead, and this check asserts that starting distance
// before it drives anything.
//
// AND IT DIES FLYING, so a build that leaves the wreck coasting is measured
// where it actually went rather than where it was put. At `DEATH_SPEED` (160)
// the wreck covers at most 40 units over the quarter-second watched, which
// leaves it more than 400 units from the safe point the whole time: the only way
// the reading below comes out small is a ship that was PLACED there.
//
// WHAT IS READ. The least the ship's centre came to the safe point over the
// watch, which is the reading for a place a ship is put and then holds. A build
// that respawns on the tick the counter fell is read on that tick, one that
// takes a few more is read when it gets there, and one that never arrives is
// read at the 481 it died at.
//
// The tolerance is `1` unit against a rule that is an assignment of two
// constants, so a conformant build has nothing to be off by; the allowance is
// there for a build that runs a tick of the new ship's own motion over the
// placement, which at rest moves it by nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { SAFE_X, SAFE_Y, START_LIVES } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { wrappedDistance, type Vec } from "../geometry";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { poseLosingDuel, watchForRespawn, watchTheDeath } from "./duel";

/** The place `specs/progression.md` fixes for the ship a death puts up. */
const SAFE: Vec = { x: SAFE_X, y: SAFE_Y };

/** How far the respawned centre may sit from the safe point, in units. */
const PLACE_TOLERANCE = 1;

/** How far the doomed ship must stand from the safe point for this to be a reading. */
const MIN_DEATH_DISTANCE = 400;

/** The ceiling on the drive to the death: see `duel.ts`. */
const DEATH_TICKS = ticksFor(0.5);

/**
 * How long the ship is watched for after the counter falls.
 *
 * `specs/progression.md` licenses no delay between the loss and the next ship,
 * so a conformant build is read on the first of these ticks; the rest are slack
 * for a build that settles the respawn a frame later, and they cost the reading
 * nothing because a ship placed at the safe point is at rest and stays there.
 */
const RESPAWN_TICKS = ticksFor(0.25);

/** How near the safe point counts as "a ship appeared there" for the watch. */
const RESPAWN_MARK = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the next ship up at the safe point", async () => {
  const rockId = poseLosingDuel(h);

  const armed = h.snapshot();
  assertGreaterThan(
    wrappedDistance({ x: armed.ship.x, y: armed.ship.y }, SAFE),
    MIN_DEATH_DISTANCE,
    "the doomed ship standing well away from the safe point, so arriving " +
      "there is something the respawn had to do",
  );

  const death = await watchTheDeath(h, rockId, DEATH_TICKS);
  assertTrue(
    death.lostAt >= 0,
    "the rock reaching the ship to cost a life (specs/collision.md)",
  );
  assertEqual(
    death.end.lives,
    START_LIVES - 1,
    "ships still remaining after the loss, which is the case " +
      "specs/progression.md puts a new ship up in",
  );

  const respawn = await watchForRespawn(h, SAFE, RESPAWN_MARK, RESPAWN_TICKS);
  captureStill(h, "respawn");

  assertEqual(
    respawn.end.lives,
    death.end.lives,
    "the watch costing no further ship, so what it read is the ship the " +
      "death put up (specs/progression.md)",
  );
  assertLessThanOrEqual(
    respawn.closest,
    PLACE_TOLERANCE,
    "the next ship's centre standing at (SAFE_X, SAFE_Y), read as the " +
      "closest its centre came to that point after the life was lost " +
      "(specs/progression.md)",
  );
});
