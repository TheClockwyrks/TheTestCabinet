// clock/timer-reaches-zero — a timer counts down to exactly `0` on its due
// tick, not to a residue.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Timers"): "On every tick a
// timer counts down by `TICK_DT` and is held at `0`: a count-down that would
// leave it below `TICK_DT / 2` leaves it at exactly `0`. A timer is due on
// every tick on which it is `0` after its count-down ... The weapon cooldown
// timers, the contact cooldowns, the re-hit entries, the spawn timer, and every
// `ttl` all count this way." specs/instrumentation.md holds it counting with
// the hits off: while `enemyContact` is off, "No enemy hits. Every
// `contactCooldown` still counts down." That the timer then STAYS at `0` is
// `clock/timer-holds-at-zero`'s.
//
// THE DRIVE. A moth overlapping the lamplighter, `enemyContact` off so no hit
// ever sets its cooldown again, and its `contactCooldown` posed to `0.5`.
// After 29 ticks it reads `0.5 − 29/60`, one `TICK_DT`, still counting. The
// 30th tick's count-down would leave `0.5 − 30/60`, which in binary floating
// point is a residue of order `1e-17` rather than `0`; the rule turns that
// into exactly `0`, and a build that reports the residue fails an exact
// comparison.
//
// THE NIGHT. An isolated run with the moth alone, every faculty held: the
// timer counts under every switch, and nothing else is needed for it to.
//
// THE TOLERANCE. `TIMER_TOL` on the reading one tick before due, where the
// timer is still counting. None on the due tick: the rule says "exactly `0`",
// and exact is what is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { CONTACT_COOLDOWN, TICK_DT, TIMER_TOL, dueTicks } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The moth's center, five units right of the lamplighter's: overlapping. */
const MOTH_DX = 5;

/** The cooldown posed: `CONTACT_COOLDOWN`, `0.5` s, 30 ticks. */
const POSED = CONTACT_COOLDOWN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads exactly 0 on the due tick", async () => {
  await isolate(h);
  const moth = await placeEnemyNear(h, "moth", MOTH_DX, 0);
  await h.debug.setEnemyContactCooldown(moth.id, POSED);
  const counting = await h.step(dueTicks(POSED) - 1);
  const due = await h.step(1);
  await captureStill(h, "zero");

  assertNear(
    mustEnemy(counting, moth.id).contactCooldown,
    TICK_DT,
    TIMER_TOL,
    "contactCooldown one tick before it is due, still counting",
  );
  assertEqual(
    mustEnemy(due, moth.id).contactCooldown,
    0,
    "contactCooldown on its due tick: exactly 0, not a residue",
  );
});
