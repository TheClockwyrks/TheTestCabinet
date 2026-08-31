// lives/respawns-facing-up — the ship a death puts up is pointing straight up.
//
// THE RULE. `specs/progression.md`: "the next ship appears at rest at the safe
// point `(SAFE_X, SAFE_Y)` = `(640, 560)` FACING `FACE_UP`", and `specs/ship.md`
// fixes `FACE_UP` at `-90` degrees, straight up. The place and the velocity are
// the two items beside this one; this one decides the FACING, so a build that
// respawns in the right place still pointing the way the last ship died loses
// exactly one point.
//
// THE SHIP DIES FACING ALONG `+x`, a right angle away from `FACE_UP`, which is
// the whole of the check: a ship that died facing up would read "facing up"
// afterwards on a build that simply never touched the angle. `duel.ts` poses the
// facing and this check asserts it before it drives anything. Nothing else can
// turn the ship — `specs/ship.md` turns it only while a turn key is held, and no
// key is held here — so the facing read after the respawn is either the one the
// respawn set or the one the pose did.
//
// WHERE IT IS READ. On the tick the new ship first stands at the safe point,
// which is what tells the respawned ship apart from the wreck 481 units away.
//
// The reading is taken as the shortest turn between the two headings, so a build
// reporting `FACE_UP` as `-90`, as `270` or as `-450` degrees passes: what
// `specs/instrumentation.md` fixes is that the facing is in radians, not which
// turn of the circle it is expressed on. The tolerance is one degree against a
// rule that is an assignment of a constant.

import { afterEach, beforeEach, it } from "vitest";
import { FACE_UP, SAFE_X, SAFE_Y, START_LIVES } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { DEG, angleBetween, type Vec } from "../geometry";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import {
  DEATH_HEADING,
  poseLosingDuel,
  requireRespawnedShip,
  watchForRespawn,
  watchTheDeath,
} from "./duel";

/** The place `specs/progression.md` fixes for the ship a death puts up. */
const SAFE: Vec = { x: SAFE_X, y: SAFE_Y };

/** How far the respawned facing may sit from `FACE_UP`, in radians. */
const FACING_TOLERANCE = 1 * DEG;

/** How far the doomed ship's facing must be from `FACE_UP` for this to be a reading. */
const MIN_DEATH_TURN = 45 * DEG;

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

it("puts the next ship up facing FACE_UP", async () => {
  const rockId = poseLosingDuel(h);

  const armed = h.snapshot();
  assertEqual(
    armed.ship.angle,
    DEATH_HEADING,
    "setShipAngle to be reported by the snapshot, so the doomed ship's " +
      "facing is the one the pose gave it (specs/instrumentation.md)",
  );
  assertGreaterThan(
    angleBetween(armed.ship.angle, FACE_UP),
    MIN_DEATH_TURN,
    "the doomed ship facing well away from FACE_UP, so pointing up is " +
      "something the respawn had to do",
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
    angleBetween(next.angle, FACE_UP),
    FACING_TOLERANCE,
    "the turn between the next ship's facing and FACE_UP (-90 degrees), " +
      "which is the facing a life begins with (specs/progression.md)",
  );
});
