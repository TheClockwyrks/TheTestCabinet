// Meltdown — instrumentation/remove-unit: `removeUnit(id)` takes that unit off the
// floor and touches nothing else.
//
// THE RULE. `specs/instrumentation.md`: "`removeUnit(id)` Removes that unit. It
// costs no life, pays no bounty, and changes neither score nor money."
//
// THE WORD UNDER TEST IS AGAIN "THAT". The unit removed is the MIDDLE of three,
// entered at two different vents, so a build that removed the last entry of its
// roster, or the first, or all of them, reads as a different roster rather than as
// coincidentally right — and the two survivors are then driven on, because a build
// that left them on the roster with their locomotion torn out has not "left every
// other unit walking".
//
// AND THE TWO ACCOUNTS A DEPARTURE NORMALLY SETTLES. `specs/economy.md` pays the
// bounty "on the frame a unit's hp reaches `0`" and `specs/surge.md` charges the
// leak its lives; this operation is neither path, so the lives, the money and the
// score stand exactly where the run left them. That reading is taken over a
// walking wave, because a build that routes a removal through its own leak path
// runs that path on a unit in motion.
//
// WHY THIS IS WORTH A POINT OF ITS OWN. `combat/retargets-when-the-target-goes`
// and every kill, leak and splash scenario in the suite takes one unit off a floor
// that holds others. A build that charges a life for it kills the run half way
// through those checks, and the failure names the lives rather than the surface.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
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

/** Seconds of game time the survivors are driven for after the removal. */
const WALK_SECONDS = 1;

/**
 * How far a survivor must travel in that second, in logical stage units.
 *
 * The slowest of the three is the Hulk at `38` logical units per second
 * (`specs/surge.md`), so a quarter of that is a floor a walking unit clears
 * easily and a stalled one cannot. How fast each type walks is `surge/*`'s
 * question.
 */
const MIN_TRAVEL = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes that unit alone and leaves the others walking", async () => {
  await startRun(h);
  const first = await poseWalker(h, "mote", "left");
  const middle = await poseWalker(h, "sprint", "top");
  const last = await poseWalker(h, "hulk", "left");

  await h.advance(1);
  const before = await h.snapshot();
  assertLength(before.surge, 3, "the surge posed onto the floor");

  await h.debug.removeUnit(middle);
  await h.advance(1);
  await captureStill(h, "removed");

  const after = await h.snapshot();
  assertDeepEqual(
    after.surge.map((unit) => unit.id),
    [first, last],
    "the surge roster after removeUnit took the middle unit",
  );

  await h.advance(framesFor(WALK_SECONDS));
  const driven = await h.snapshot();
  for (const id of [first, last]) {
    assertGreaterThan(
      distance(
        requireUnit(after, id, "a unit the removal left standing"),
        requireUnit(driven, id, "a unit the removal left standing"),
      ),
      MIN_TRAVEL,
      `unit ${id} walked in the second after removeUnit`,
    );
  }
});

it("costs no life and pays no bounty", async () => {
  await startRun(h);
  await h.debug.setMoney(POSED_MONEY);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setScore(POSED_SCORE);

  await poseWalker(h, "mote", "left");
  // The Core: the costliest unit on the roster to lose either way, at `90` money
  // and score for a kill and `5` lives for a leak (`specs/surge.md`), so a build
  // that settled either account is out by a figure nothing could round away.
  const removed = await poseWalker(h, "core", "top");
  await poseWalker(h, "hulk", "left");

  // Walking when it is taken, which is the state a leak path is written for.
  await h.advance(framesFor(WALK_SECONDS));
  const before = await h.snapshot();

  await h.debug.removeUnit(removed);
  const after = await h.snapshot();

  assertLength(after.surge, 2, "the surge roster after removeUnit");
  assertEqual(after.lives, before.lives, "the lives removeUnit left");
  assertEqual(after.money, before.money, "the money removeUnit left");
  assertEqual(after.score, before.score, "the score removeUnit left");
});
