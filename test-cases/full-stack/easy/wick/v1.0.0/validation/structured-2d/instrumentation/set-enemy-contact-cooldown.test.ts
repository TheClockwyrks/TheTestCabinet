// Wick — instrumentation/set-enemy-contact-cooldown:
// `setEnemyContactCooldown(id, 0.5)` on an overlapping moth reads back
// `contactCooldown` 0.5, and with `enemyContact` on the moth's next hit lands
// on the 30th tick after the call.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setEnemyContactCooldown(id, seconds)`: "Sets enemy `id`'s
// `contactCooldown` to `seconds`". `specs/world.md`, "Timers": due
// `round(s × TICK_HZ)` ticks after it is set, 30 for 0.5 s; "Contact damage":
// an overlapping enemy whose cooldown is due lands a hit of
// `max(MIN_DAMAGE_TAKEN, damage − armor)`, 5 for a moth with no Brass.
//
// THE DRIVE. An isolated run, `enemyMotion` off, a moth at the lamplighter's
// center (overlapping), the pose read at the call, `enemyContact` on: hp
// whole through 29 ticks, down by 5 on the 30th.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import { BASE_MAX_HP, ENEMIES, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICKS = ticksOf(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the cooldown and the hit lands when it is due", async () => {
  isolate(h);
  const id = placeEnemyNear(h, "moth", 0, 0);
  h.debug.setEnemyContactCooldown(id, POSED_SECONDS);
  const posed = enemyById(h.snapshot(), id);
  assertDefined(posed, "the overlapping moth");
  assertEqual(
    posed?.contactCooldown,
    POSED_SECONDS,
    "contactCooldown after the pose",
  );
  enable(h, "enemyContact");

  const { early, due } = await captureReplay(h, "cooled", async () => {
    const early = await advanceTicks(h, DUE_TICKS - 1);
    const due = await advanceTicks(h, 1);
    return { early, due };
  });

  assertEqual(
    early.run.player.hp,
    BASE_MAX_HP,
    `hp after ${DUE_TICKS - 1} ticks`,
  );
  assertEqual(
    due.run.player.hp,
    BASE_MAX_HP - ENEMIES.moth.damage,
    `hp on the ${DUE_TICKS}th tick`,
  );
});
