// instrumentation/set-enemy-contact-cooldown — `setEnemyContactCooldown(id,
// 0.5)` on an overlapping moth reads back contactCooldown 0.5, and with
// enemyContact on the moth's next hit lands on the 30th tick after the call.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md,
// `setEnemyContactCooldown`: "Sets enemy `id`'s `contactCooldown` to
// `seconds`, at least `0`". specs/world.md, "Contact damage": "An overlapping
// enemy whose `contactCooldown` is due lands a hit"; "Timers": a 0.5 s timer
// is due 30 ticks after it is set.
//
// THE POSE. An isolated run, a moth overlapping the lamplighter with its
// motion off, the pose read back at FIGURE_TOLERANCE, `enemyContact` on, and
// a trace: hp holds through tick 29 and falls on tick 30.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertWithin } from "../assert";
import { BASE_MAX_HP, FIGURE_TOLERANCE, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICK = ticksFor(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the cooldown and the hit lands when it is due", async () => {
  isolate(h);
  const id = spawnEnemyAt(h, "moth", 5, 0);

  h.debug.setEnemyContactCooldown(id, POSED_SECONDS);
  assertWithin(
    enemyById(h.snapshot(), id)?.contactCooldown ?? Number.NaN,
    POSED_SECONDS,
    FIGURE_TOLERANCE,
    "contactCooldown read back",
  );
  enable(h, "enemyContact");

  const seen = await captureReplay(h, "cooled", () =>
    h.trace(DUE_TICK, (s) => s.run.player.hp < BASE_MAX_HP),
  );

  assertEqual(seen.length, DUE_TICK, "the tick the hit landed on");
  assertEqual(
    seen[DUE_TICK - 2].run.player.hp,
    BASE_MAX_HP,
    "hp a tick before the cooldown was due",
  );
  assertLessThan(
    seen[DUE_TICK - 1].run.player.hp,
    BASE_MAX_HP,
    "hp on the due tick",
  );
});
