// Wick — clock/timer-holds-at-zero: a timer that has reached 0 stays due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Timers"): "On every tick a timer counts down by
//     `TICK_DT` and is held at `0`: a count-down that would leave it below
//     `TICK_DT / 2` leaves it at exactly `0`. A timer is due on every tick on
//     which it is `0` after its count-down ... and a timer at `0` stays due on
//     every tick until it is set again. The weapon cooldown timers, the contact
//     cooldowns, the lamplighter's `hurtFlash`, the re-hit entries, the spawn
//     timer, and every `ttl` all count this way."
//   - `specs/instrumentation.md` ("The driver switches"): with `enemyContact`
//     off, "No enemy hits. Every `contactCooldown` still counts down."
//   - `specs/instrumentation.md` (`setEnemyContactCooldown`): "Sets enemy
//     `id`'s `contactCooldown` to `seconds`, at least `0`."
//   - `specs/world.md` ("Contact damage"): with the cooldown due and
//     `enemyContact` on, an overlapping enemy would set it back to
//     `CONTACT_COOLDOWN`, which is why the switch is off here.
//
// WHAT IS READ. A moth overlapping the lamplighter has its contact cooldown
// posed to 0.5 s with `enemyContact` off, so the timer counts and nothing sets
// it again. round(0.5 × 60) is 30, so the 30th tick brings it due; that it
// reads exactly 0 there is `clock/timer-reaches-zero`'s. Across twenty further
// ticks it must stay exactly 0.
//
// WHY THE NIGHT IS POSED AS IT IS. The contact cooldown is the one timer the
// surface can pose, read on every tick, and leave untouched by anything but
// the count-down: with `enemyContact` off nothing lands a hit to set it, and
// with `enemyMotion` off the moth stays where it overlaps. Nothing else is in
// the night.
//
// TOLERANCE. None on the readings of 0: the spec says "exactly `0`", and a
// build that reports a residue has kept the residue.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CONTACT_COOLDOWN, ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The cooldown posed: `CONTACT_COOLDOWN`, 0.5 s, due on the 30th tick. */
const POSED = CONTACT_COOLDOWN;

/** Ticks driven after the timer reaches 0, on which it must stay there. */
const HELD_TICKS = 20;

/** The moth's offset from the lamplighter: inside 10 + 12, so it overlaps. */
const MOTH_DX = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The value with a negative zero read as zero, since `Object.is` tells them apart. */
function exact(value: number): number {
  return value === 0 ? 0 : value;
}

it("holds a due timer at exactly 0", async () => {
  isolate(h);
  const id = spawnEnemyNear(h, "moth", MOTH_DX, 0);
  h.debug.setEnemyContactCooldown(id, POSED);
  const dueTick = ticksFor(POSED);

  await h.tick(dueTick);

  const held = await h.trace(HELD_TICKS);
  captureStill(h, "zero");
  held.forEach((snapshot, i) => {
    assertEqual(
      exact(enemyById(snapshot, id)?.contactCooldown ?? Number.NaN),
      0,
      `contactCooldown on tick ${dueTick + i + 1}, past the due tick`,
    );
  });
});
