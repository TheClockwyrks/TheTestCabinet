// clock/timer-holds-at-zero — a timer that has reached `0` stays there.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Timers"): "On every tick a
// timer counts down by `TICK_DT` and is held at `0` ... and a timer at `0`
// stays due on every tick until it is set again. The weapon cooldown timers,
// the contact cooldowns, the re-hit entries, the spawn timer, and every `ttl`
// all count this way." specs/world.md ("Contact damage"): "The cooldown counts
// down on every tick the enemy is alive, in or out of contact", and
// specs/instrumentation.md holds it counting with the hits off: while
// `enemyContact` is off, "No enemy hits. Every `contactCooldown` still counts
// down."
//
// THE DRIVE. A moth overlapping the lamplighter, `enemyContact` off so no hit
// ever sets its cooldown again, and its `contactCooldown` posed to `0.5`.
// The 30th tick brings it due; that it reads exactly `0` there is
// `clock/timer-reaches-zero`'s. Sixty ticks later it must still read exactly
// `0`: not negative, not wrapped, not reset.
//
// THE NIGHT. An isolated run with the moth alone, every faculty held: the
// timer counts under every switch, and nothing else is needed for it to.
//
// THE TOLERANCE. None: the rule says "exactly `0`", and exact is what is
// read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CONTACT_COOLDOWN, dueTicks } from "../constants";
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

/** Ticks run past the due tick, over which the timer stays at zero. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a due timer at exactly 0", async () => {
  await isolate(h);
  const moth = await placeEnemyNear(h, "moth", MOTH_DX, 0);
  await h.debug.setEnemyContactCooldown(moth.id, POSED);
  await h.step(dueTicks(POSED));
  const held = await h.step(HELD_TICKS);
  await captureStill(h, "zero");

  assertEqual(
    mustEnemy(held, moth.id).contactCooldown,
    0,
    "contactCooldown 60 ticks after it came due, with enemyContact off",
  );
});
