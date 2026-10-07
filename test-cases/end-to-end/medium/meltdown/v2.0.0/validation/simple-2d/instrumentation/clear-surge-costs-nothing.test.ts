// Meltdown — instrumentation/clear-surge-costs-nothing: clearSurge costs no life
// and pays no bounty.
//
// specs/instrumentation.md, The surge: `clearSurge()` "costs no life, pays no
// bounty, and changes neither score nor money". It is the counterpart to the two
// ways a unit really leaves the floor: specs/surge.md takes a life for a leak and
// specs/economy.md pays a bounty for a kill, and a `clearSurge` that ran either
// path would pay a floor of units off as if the player had earned it.
//
// THE FLOOR IS WALKING WHEN IT IS CLEARED, which is what makes both wrong paths
// reachable: a build that clears a unit by removing it the way a leak does, and one
// that clears it the way a kill does, are both driven through the same operation
// here. Six units are enough that either mistake moves its figure by more than a
// rounding — six Motes are `6` lives on the leak path (specs/surge.md) and `18`
// money on the kill path (specs/economy.md).
//
// EVERY FIGURE IS POSED AWAY FROM THE VALUE A MISTAKE WOULD LEAVE. `46` lives is
// neither `0` nor the mode's starting lives, `4321` money is no bounty's multiple,
// and `90210` score is not `0`, so a build that clears any of the three is caught
// rather than agreeing with a default.
//
// AND THE UNITS ARE POSED WELL CLEAR OF THEIR EXHAUST, five tiles into the left
// corridor (specs/floor.md), so nothing leaks under the reading and the only thing
// that removes them is the clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { WALK, poseWalkerOn } from "./scenes";

/** The run figures posed, each away from the value a mistake would leave. */
const MONEY = 4321;
const LIVES = 46;
const SCORE = 90210;

/** How many units are walking when the clear arrives. */
const WALKERS = 6;

/** How long they are left walking first: half a second of game time. */
const WALK_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves lives, money and score exactly as they were when a walking wave is cleared", async () => {
  startRun(h);
  for (let i = 0; i < WALKERS; i += 1) {
    poseWalkerOn(h, "mote", WALK.col + i, WALK.row);
  }

  // The balance is posed AFTER the floor is walking, so what this point reads is
  // what the CLEAR did to it rather than anything the arrangement did.
  h.debug.setScore(SCORE);
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  await h.advance(WALK_TICKS);

  const walking = h.snapshot();
  assertLength(walking.surge, WALKERS, "precondition: the floor is walking");
  assertEqual(walking.money, MONEY, "precondition: the money posed is on hand");
  assertEqual(
    walking.lives,
    LIVES,
    "precondition: the lives posed are on hand",
  );
  assertEqual(walking.score, SCORE, "precondition: the score posed is on hand");

  h.debug.clearSurge();
  const cleared = h.snapshot();

  assertLength(cleared.surge, 0, "precondition: the wave really was cleared");
  assertEqual(cleared.lives, LIVES, "clearSurge costs no life");
  assertEqual(cleared.money, MONEY, "clearSurge pays no bounty");
  assertEqual(cleared.score, SCORE, "clearSurge changes no score");

  await h.advance(1);
  captureStill(h, "balance");
});
