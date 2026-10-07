// Meltdown — instrumentation/remove-unit: `removeUnit` removes exactly one unit.
//
// `specs/instrumentation.md`: "`removeUnit(id)` — Removes that unit. It costs no
// life, pays no bounty, and changes neither score nor money."
//
// EXACTLY ONE is the requirement, and it is why the floor carries three walkers.
// A build whose `removeUnit` emptied the roster passes any reading taken with one
// unit on it, so the two the call did not name are read back by id afterwards —
// and read again a moment later, having MOVED, because a build that removed the
// right unit and froze the rest has broken the same thing in a quieter way.
//
// THE THREE WALK UNDER THEIR OWN POWER on the open row `specs/floor.md` runs from
// the left vent to the right exhaust, so "still walking" is the game's own
// pathing and movement rather than anything this check arranged. They start a
// tile apart, so the two survivors are told from one another by position as well
// as by id.
//
// NOTHING IS PAID FOR IT, and all three figures are read, because "costs no life,
// pays no bounty, and changes neither score nor money" is three claims:
// `specs/economy.md` pays a Mote's bounty of `3` on a death and `specs/surge.md`
// charges a Mote's `1` life on a leak, so a build that emptied the roster through
// either of the real paths moves a figure this reads.
//
// THE FLOOR IS EMPTY OF TOWERS AND THE WORLD GATE IS OFF, so no shot can kill a
// walker and no release can add one: the only thing that changes the roster over
// this reading is the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { SURGE_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  positionOf,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { OPEN_ROW, poseWalkerAt, readUnit } from "./ground";

/** How many walkers stand on the floor when the call is made. */
const WALKERS = 3;

/** Which of them is removed: the middle one, so an off-by-one is visible. */
const REMOVED = 1;

/** The figures posed before the removal, none of them a value an event lands on. */
const POSED_MONEY = 4321;
const POSED_LIVES = 17;
const POSED_SCORE = 987_654;

/** Frames run before the removal, so the walkers are genuinely under way. */
const WALK_FRAMES = 60;

/** The game time the survivors are watched over afterwards, in frames. */
const WATCH_FRAMES = ticksFor(0.5);

/**
 * The least distance that watch must carry a survivor, in logical units.
 *
 * `specs/surge.md` gives the Mote `60` logical units a second, so the half second
 * this watches carries it thirty. A quarter of that is the floor: far over the
 * zero a frozen build produces and over the twentieth of a tile an inching one
 * would, and still far under thirty, because how fast a Mote walks is `surge.*`'s
 * question rather than this point's. It is the same
 * quarter-of-the-specified-figure floor the engineless project's copy of this
 * point holds.
 */
const MIN_TRAVEL = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes that unit alone, leaves the rest walking and pays nothing", async () => {
  startRun(h);
  h.debug.setMoney(POSED_MONEY);
  h.debug.setLives(POSED_LIVES);
  h.debug.setScore(POSED_SCORE);

  const ids: number[] = [];
  for (let i = 0; i < WALKERS; i += 1) {
    ids.push(
      poseWalkerAt(h, "mote", { col: OPEN_ROW.col + i, row: OPEN_ROW.row }),
    );
  }
  await h.advance(WALK_FRAMES);

  const before = h.snapshot();
  assertLength(
    before.towers,
    0,
    "precondition: nothing on the floor could kill one",
  );
  assertLength(before.surge, WALKERS, "precondition: the walkers on the floor");
  assertGreaterThan(
    SURGE_DEFS.mote.bounty,
    0,
    "precondition: a mistaken bounty would be a figure worth reading",
  );
  const survivors = ids.filter((_, index) => index !== REMOVED);
  const wasAt = survivors.map((id) =>
    positionOf(readUnit(before, id, "a walker the removal must leave alone")),
  );

  h.debug.removeUnit(ids[REMOVED]);
  await h.advance(1);
  captureStill(h, "removed");
  const after = h.snapshot();

  assertLength(after.surge, WALKERS - 1, "the surge roster after removeUnit");
  assertEqual(
    after.surge.some((unit) => unit.id === ids[REMOVED]),
    false,
    "the removed unit is off the roster",
  );
  for (const id of survivors) {
    assertEqual(
      after.surge.some((unit) => unit.id === id),
      true,
      `walker ${id} is still on the roster`,
    );
  }

  // And still walking, under the game's own rules.
  await h.advance(WATCH_FRAMES);
  const later = h.snapshot();
  for (const [index, id] of survivors.entries()) {
    const now = positionOf(readUnit(later, id, "a walker after the removal"));
    assertGreaterThan(
      now.x - wasAt[index].x,
      MIN_TRAVEL,
      `the logical units walker ${id} covered after the removal`,
    );
  }

  assertEqual(later.lives, POSED_LIVES, "the lives after removeUnit");
  assertEqual(later.money, POSED_MONEY, "the money after removeUnit");
  assertEqual(later.score, POSED_SCORE, "the score after removeUnit");
});
