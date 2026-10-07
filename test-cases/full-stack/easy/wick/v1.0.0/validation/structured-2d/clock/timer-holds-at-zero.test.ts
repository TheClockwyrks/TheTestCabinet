// Wick — clock/timer-holds-at-zero: a timer that has reached `0` stays due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Timers"): "a timer at `0` stays due on every tick
//     until it is set again." And: "the contact cooldowns ... all count this
//     way."
//   - `specs/instrumentation.md` ("The driver switches"), `enemyContact` off:
//     "No enemy hits. Every `contactCooldown` still counts down." And
//     `enemyMotion` off: "`age` and `contactCooldown` still count."
//   - `specs/instrumentation.md` (`setEnemyContactCooldown`): "Sets enemy
//     `id`'s `contactCooldown` to `seconds`, at least `0`."
//
// THE DRIVE. An isolated run, every switch off. One moth is posed overlapping
// the lamplighter, so that the only thing keeping its cooldown from being set
// again is the `enemyContact` switch, and its cooldown is posed to 0.5 s.
// The thirtieth tick brings it due; that it reads exactly `0` there is
// `clock/timer-reaches-zero`'s. Thirty ticks further it must still read exactly
// `0`, because a due timer that is never set again stays due.
//
// TOLERANCE. None: "exactly `0`" is the rule under test, and a residue of any
// size fails it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CONTACT_COOLDOWN, ticksOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

/** The posed timer: the contact cooldown's own figure, due 30 ticks on. */
const POSED = CONTACT_COOLDOWN;
const DUE_TICKS = ticksOf(POSED);

/** Where the moth stands: 5 units out, overlapping the lamplighter's circle. */
const MOTH_X = 5;

/** Ticks run past the due tick, to read the timer resting. */
const RESTING_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds a due contact cooldown at exactly 0", async () => {
  isolate(h);
  const moth = placeEnemy(h, "moth", MOTH_X, 0);
  h.debug.setEnemyContactCooldown(moth, POSED);

  await advanceTicks(h, DUE_TICKS);
  const resting = await advanceTicks(h, RESTING_TICKS);
  const restingRead = enemyById(resting, moth)?.contactCooldown;
  captureStill(h, "zero");

  assertEqual(
    restingRead,
    0,
    `the moth's contactCooldown ${RESTING_TICKS} ticks after it reached 0`,
  );
});
