// Meltdown — instrumentation/remove-unit: removeUnit removes exactly one unit.
//
// specs/instrumentation.md, The surge: `removeUnit(id)` "Removes that unit. It
// costs no life, pays no bounty, and changes neither score nor money."
//
// EXACTLY ONE, AND THE FLOOR SAYS WHICH. Four units walk the left corridor and the
// second of them is taken away: the named one is gone, and the other three are
// still on the roster at the same ids AND STILL WALKING — each of them travels
// further over the half-second after the removal, which is what tells a build that
// removed one unit apart from one that removed one and froze the rest.
//
// AND NOTHING IS PAID FOR IT. A unit really leaving the floor moves two figures:
// specs/surge.md takes its leak value in lives when it reaches its exhaust, and
// specs/economy.md pays its bounty when its hp reaches `0`. `removeUnit` is neither
// path, so a Mote removed here must move neither the `46` lives nor the `4321`
// money — both posed away from any value a mistake would leave, and the `90210`
// score posed away from the `0` a cleared score would agree with.
//
// THE UNITS ARE POSED WELL CLEAR OF THEIR EXHAUST, five tiles into the left corridor
// (specs/floor.md), so nothing leaks under the reading and the only thing that takes
// a unit off the floor is the removal.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { TILE } from "../../src/constants";
import {
  captureStill,
  createHarness,
  hasUnit,
  startRun,
  ticksFor,
  unitOf,
  type Harness,
} from "../harness";
import { WALK, poseWalkerOn } from "./scenes";

/** How many units walk the corridor, and which of them is removed. */
const WALKERS = 4;
const REMOVED = 1;

/** The run figures posed, so a leak's cost or a bounty is observable. */
const MONEY = 4321;
const LIVES = 46;
const SCORE = 90210;

/** How long the survivors are watched after the removal: half a second. */
const WATCH_TICKS = ticksFor(0.5);

/**
 * How far a survivor must travel over that half-second, in logical units.
 *
 * A third of a tile. A Mote's specified speed is `60` logical units per second
 * (specs/surge.md), so half a second is `30` units — five times this bound. What
 * the bound has to separate is a unit that is WALKING from one that is not, and a
 * build whose Mote walks at less than a fifth of its specified speed is failed by
 * `surge`'s own speed item rather than by this one.
 */
const MOVING_MIN = TILE / 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes that unit alone, leaves the rest walking, and costs nothing", async () => {
  startRun(h);
  const walkers: number[] = [];
  for (let i = 0; i < WALKERS; i += 1) {
    walkers.push(poseWalkerOn(h, "mote", WALK.col + i, WALK.row));
  }

  // The balance is posed AFTER the floor is walking, so what this point reads is
  // what the REMOVAL did to it rather than anything the arrangement did.
  h.debug.setScore(SCORE);
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  await h.advance(1);
  const before = h.snapshot();
  assertLength(before.surge, WALKERS, "precondition: the floor is walking");

  h.debug.removeUnit(walkers[REMOVED]);
  const removed = h.snapshot();

  assertTrue(!hasUnit(removed, walkers[REMOVED]), "the named unit is removed");
  assertLength(removed.surge, WALKERS - 1, "exactly one unit is removed");
  for (const [index, id] of walkers.entries()) {
    if (index === REMOVED) continue;
    assertTrue(hasUnit(removed, id), `unit ${id} is left on the floor`);
  }

  // Nothing was paid for it.
  assertEqual(removed.lives, LIVES, "removeUnit costs no life");
  assertEqual(removed.money, MONEY, "removeUnit pays no bounty");
  assertEqual(removed.score, SCORE, "removeUnit changes no score");

  // And the survivors are still walking.
  await h.advance(WATCH_TICKS);
  const later = h.snapshot();
  captureStill(h, "removed");
  for (const [index, id] of walkers.entries()) {
    if (index === REMOVED) continue;
    const from = unitOf(removed, id);
    const to = unitOf(later, id);
    assertGreaterThan(
      Math.hypot(to.x - from.x, to.y - from.y),
      MOVING_MIN,
      `logical units unit ${id} travelled after the removal`,
    );
  }
});
