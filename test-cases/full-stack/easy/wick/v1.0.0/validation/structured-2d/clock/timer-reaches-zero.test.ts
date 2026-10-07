// Wick — clock/timer-reaches-zero: a timer counts down to exactly `0` on its
// due tick, not to a residue.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Timers"): "On every tick a timer counts down by
//     `TICK_DT` and is held at `0`: a count-down that would leave it below
//     `TICK_DT / 2` leaves it at exactly `0`." And: "the contact cooldowns ...
//     all count this way."
//   - `specs/instrumentation.md` ("The driver switches"), `enemyContact` off:
//     "No enemy hits. Every `contactCooldown` still counts down." And
//     `enemyMotion` off: "`age` and `contactCooldown` still count."
//   - `specs/instrumentation.md` (`setEnemyContactCooldown`): "Sets enemy
//     `id`'s `contactCooldown` to `seconds`, at least `0`."
//
// THE DRIVE. An isolated run, every switch off. One moth is posed overlapping
// the lamplighter, so that the only thing keeping its cooldown from being set
// again is the `enemyContact` switch, and its cooldown is posed to 0.5 s.
// Twenty-nine ticks later the timer is one `TICK_DT` from done; on the
// thirtieth it reads EXACTLY `0`, not the `0.5 − 30 / 60` residue that thirty
// floating-point subtractions leave (about 1e-17, which the hold rule turns
// into `0`). That the timer then STAYS at `0` is `clock/timer-holds-at-zero`'s.
//
// TOLERANCE. None on the zero: "exactly `0`" is the rule under test, and a
// residue of any size fails it. `MOTION_EPS` on the one-tick-short reading,
// twenty-nine count-downs of a stated real.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { CONTACT_COOLDOWN, MOTION_EPS, TICK_DT, ticksOf } from "../constants";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("counts a contact cooldown to exactly 0 on the 30th tick", async () => {
  isolate(h);
  const moth = placeEnemy(h, "moth", MOTH_X, 0);
  h.debug.setEnemyContactCooldown(moth, POSED);

  const short = await advanceTicks(h, DUE_TICKS - 1);
  const shortRead = enemyById(short, moth)?.contactCooldown;
  const due = await advanceTicks(h, 1);
  const dueRead = enemyById(due, moth)?.contactCooldown;
  captureStill(h, "zero");

  assertNear(
    shortRead ?? Number.NaN,
    TICK_DT,
    MOTION_EPS,
    `the moth's contactCooldown on the ${DUE_TICKS - 1}th tick after 0.5 was posed`,
  );
  assertEqual(
    dueRead,
    0,
    `the moth's contactCooldown on the ${DUE_TICKS}th tick after 0.5 was posed`,
  );
});
