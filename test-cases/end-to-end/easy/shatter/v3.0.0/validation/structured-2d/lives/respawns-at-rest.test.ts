// lives/respawns-at-rest — the ship a death puts up is standing still.
//
// THE RULE. `specs/progression.md`: "the next ship appears AT REST at the safe
// point". The place and the facing are the two items beside this one; this one
// decides the VELOCITY, so a build that respawns in the right place still
// carrying the dead ship's momentum loses exactly one point.
//
// THE SHIP DIES AT 160 UNITS PER SECOND, which is the whole of the check. A ship
// that died standing still would read "at rest" afterwards on a build that
// simply never touched the velocity, so `duel.ts` poses one that is going
// somewhere and this check asserts that speed before it drives anything. The
// only thing that bleeds a ship's speed on its own is the drag
// `specs/ship.md` states, and at `SHIP_DRAG_HALFLIFE` (`3.0` s) the quarter
// second watched here takes 4 percent off — a ship the respawn did not stop is
// still doing better than 150 units per second when it is read.
//
// WHERE IT IS READ. On the tick the new ship first stands at the safe point,
// which is what tells the respawned ship apart from the wreck 481 units away.
// A build that respawns on the tick the counter fell is read there.
//
// The tolerance is `1` unit per second against a rule that is an assignment of
// zero, so a conformant build has nothing to be off by; the allowance covers a
// build that runs a tick of the new ship's own physics over the placement, which
// with no thrust held adds nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { SAFE_X, SAFE_Y, START_LIVES } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { speedOf, type Vec } from "../geometry";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import {
  DEATH_SPEED,
  poseLosingDuel,
  requireRespawnedShip,
  watchForRespawn,
  watchTheDeath,
} from "./duel";

/** The place `specs/progression.md` fixes for the ship a death puts up. */
const SAFE: Vec = { x: SAFE_X, y: SAFE_Y };

/** How fast the respawned ship may be going, in units per second. */
const REST_TOLERANCE = 1;

/** How fast the doomed ship must be going for this to be a reading. */
const MIN_DEATH_SPEED = DEATH_SPEED / 2;

/** The ceiling on the drive to the death: see `duel.ts`. */
const DEATH_TICKS = ticksFor(0.5);

/** How long the ship is watched for after the counter falls. */
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

it("puts the next ship up at rest", async () => {
  const rockId = poseLosingDuel(h);

  const armed = h.snapshot();
  assertGreaterThan(
    speedOf(armed.ship),
    MIN_DEATH_SPEED,
    "the doomed ship really flying, so coming to rest is something the " +
      "respawn had to do",
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

  const next = requireRespawnedShip(respawn);
  assertLessThanOrEqual(
    speedOf(next),
    REST_TOLERANCE,
    "the next ship's speed where it appeared — it appears at rest " +
      "(specs/progression.md)",
  );
});
