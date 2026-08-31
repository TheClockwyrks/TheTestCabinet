// Meltdown — instrumentation/clear-surge-costs-nothing: `clearSurge` costs no
// life and pays no bounty.
//
// `specs/instrumentation.md`: `clearSurge()` "costs no life, pays no bounty, and
// changes neither score nor money", and `removeUnit(id)` carries the same rule
// for one unit. It is the direction that separates a clear from the two ways a
// unit really leaves the floor: `specs/economy.md` pays the killed unit's bounty
// into the money and `specs/surge.md` charges a leak against the lives, so a
// build that emptied the floor through its own death path would pay for every
// unit, and one that emptied it through its leak path would end the run.
//
// THE UNITS ARE WALKING AND THE FLOOR IS QUIET. Nothing is posed still: a
// stationary unit could not leak whatever the build did with it, so the reading
// would be of a floor where the wrong answer was impossible. What holds the run
// steady instead is the world gate, which stops the run releasing surge of its
// own while the reading is taken, and an empty tower roster, so no shot can kill
// a unit and pay a bounty for a reason that has nothing to do with the clear.
//
// THE THREE FIGURES ARE POSED WHERE NO EVENT WOULD LAND THEM. `specs/surge.md`
// gives the Mote a leak of `1` life and `specs/economy.md` a bounty of `3`, so
// six units cleared through the wrong path would move the lives by six or the
// money by eighteen — figures far enough from the posed ones that a build cannot
// arrive at them by accident. All three are read, because "costs no life, pays no
// bounty, and changes neither score nor money" is three claims and a build that
// credited only the score would pass any one of them alone.
//
// Whether the clear actually cleared is `clear-surge`'s point; this one asserts
// it as its precondition.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { OPEN_ROW, poseWalkerAt } from "./ground";

/** How many walkers stand on the floor when the clear is called. */
const WALKERS = 6;

/** The figures posed before the clear, none of them a value an event lands on. */
const POSED_MONEY = 4321;
const POSED_LIVES = 17;
const POSED_SCORE = 987_654;

/** What clearing these units the wrong way would pay, or charge. */
const BOUNTY_IF_PAID = WALKERS * SURGE_DEFS.mote.bounty;
const LIVES_IF_CHARGED = WALKERS * SURGE_DEFS.mote.leak;

/** Frames run before the clear, so the walkers are genuinely under way. */
const WALK_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves lives, money and score exactly where they were", async () => {
  startRun(h);
  h.debug.setMoney(POSED_MONEY);
  h.debug.setLives(POSED_LIVES);
  h.debug.setScore(POSED_SCORE);

  // Walkers under their own power on an open row, with nothing on the floor that
  // could kill one and no release that could add one.
  for (let i = 0; i < WALKERS; i += 1) {
    poseWalkerAt(h, "mote", { col: OPEN_ROW.col + i, row: OPEN_ROW.row });
  }
  await h.advance(WALK_FRAMES);

  const before = h.snapshot();
  assertLength(before.towers, 0, "precondition: nothing on the floor could kill one");
  assertLength(before.surge, WALKERS, "precondition: the walkers on the floor");
  assertEqual(before.money, POSED_MONEY, "precondition: the money before the clear");
  assertEqual(before.lives, POSED_LIVES, "precondition: the lives before the clear");
  assertEqual(before.score, POSED_SCORE, "precondition: the score before the clear");
  assertGreaterThan(
    BOUNTY_IF_PAID,
    0,
    "precondition: a mistaken bounty would be a figure worth reading",
  );
  assertGreaterThan(
    LIVES_IF_CHARGED,
    0,
    "precondition: a mistaken leak would be a figure worth reading",
  );

  h.debug.clearSurge();
  await h.advance(1);
  captureStill(h, "balance");
  const after = h.snapshot();

  assertLength(
    after.surge,
    0,
    "precondition: the clear emptied the floor it was asked to clear",
  );
  assertEqual(after.lives, POSED_LIVES, "the lives after clearSurge");
  assertEqual(after.money, POSED_MONEY, "the money after clearSurge");
  assertEqual(after.score, POSED_SCORE, "the score after clearSurge");
});
