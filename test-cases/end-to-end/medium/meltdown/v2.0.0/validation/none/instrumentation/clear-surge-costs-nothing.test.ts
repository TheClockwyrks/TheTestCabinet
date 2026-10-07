// Meltdown — instrumentation/clear-surge-costs-nothing: taking a walking wave off
// the floor through the surface costs nothing and pays nothing.
//
// THE RULE. `specs/instrumentation.md` says of `clearSurge`: "It costs no life,
// pays no bounty, and changes neither score nor money." The two paths a unit
// LEAVES the floor by both settle an account — `specs/economy.md` pays the
// bounty "on the frame a unit's hp reaches `0`", and `specs/surge.md` charges the
// leak its lives — and this operation is deliberately neither of them.
//
// WHY IT IS A POINT. `startRun` clears the surge to open every scenario in this
// project, and the economy and lives groups then read money, score and lives to
// the unit. A build whose `clearSurge` routes through its own leak path debits a
// life for every unit standing when the last check ended, and the run is dead
// before some later check has posed anything; one that routes through its kill
// path credits a bounty per unit and every money reading in the suite is high.
// Either way the failing item names the economy, not the surface.
//
// THE WAVE IS WALKING WHEN IT IS CLEARED, and that is the distinguishing part.
// A roster of units posed and never driven could be dropped by a build that never
// runs a departure path at all; a wave that has been released into motion, part
// way across the floor, is what a build's own leak and kill paths are written to
// handle.
//
// THE READING IS A BEFORE AND AN AFTER either side of the clear with no frame
// between them, so nothing else in the game can have moved any of the three. It
// asserts no particular balance: whatever the run stood at is what the clear must
// leave.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { SURGE_TYPES } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  framesFor,
  poseWalker,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** Money, lives and a score posed to figures no accident could produce. */
const POSED_MONEY = 4137;
const POSED_LIVES = 13;
const POSED_SCORE = 6821;

/** Seconds of game time the wave walks before it is cleared. */
const WALK_SECONDS = 2;

/**
 * How far the leading unit must have travelled for the wave to count as walking,
 * in logical stage units.
 *
 * A quarter of a tile. The check is that the units are in motion rather than
 * standing where they entered; how fast each type walks is `surge/*`'s question.
 */
const MIN_TRAVEL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves lives, money and score exactly as a walking wave found them", async () => {
  await startRun(h);
  await h.debug.setMoney(POSED_MONEY);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setScore(POSED_SCORE);

  const ids: number[] = [];
  for (const [index, type] of SURGE_TYPES.entries()) {
    ids.push(await poseWalker(h, type, index % 2 === 0 ? "left" : "top"));
  }
  const entered = await h.snapshot();

  await h.advance(framesFor(WALK_SECONDS));
  const walking = await h.snapshot();
  assertLength(
    walking.surge,
    SURGE_TYPES.length,
    "the wave posed onto the floor",
  );
  assertGreaterThan(
    distance(
      requireUnit(entered, ids[0], "the leading unit"),
      requireUnit(walking, ids[0], "the leading unit"),
    ),
    MIN_TRAVEL,
    "the wave was walking when it was cleared",
  );

  await h.debug.clearSurge();
  const cleared = await h.snapshot();
  await captureStill(h, "balance");

  assertLength(cleared.surge, 0, "the surge roster after clearSurge");
  assertEqual(cleared.lives, walking.lives, "the lives clearSurge left");
  assertEqual(cleared.money, walking.money, "the money clearSurge left");
  assertEqual(cleared.score, walking.score, "the score clearSurge left");
});
