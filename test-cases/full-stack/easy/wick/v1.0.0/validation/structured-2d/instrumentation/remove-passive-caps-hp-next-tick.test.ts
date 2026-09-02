// Wick — instrumentation/remove-passive-caps-hp-next-tick: with Tallow 2 held
// and hp 130, `removePassive` on Tallow's slot reads back `maxHp` 100 with hp
// 130 until the next `playing` tick, after which hp reads 100.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `removePassive(slot)`: "`hp` is capped at the new `maxHp` on the next
// tick's recovery step." `specs/world.md`, "Health and recovery":
// `hp = min(maxHp, hp + recovery × TICK_DT)` on every tick, with recovery 0
// and no Tinder held.
//
// THE DRIVE. An isolated run with Tallow 2 placed and hp posed to 130 (its
// `maxHp`), the removal read at the call, then one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP, maxHpOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

const TALLOW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps hp above the new maxHp until the next tick caps it", async () => {
  isolate(h);
  const slot = holdPassive(h, "tallow", TALLOW);
  h.debug.setHp(maxHpOf(TALLOW));
  assertEqual(
    h.snapshot().run.player.hp,
    maxHpOf(TALLOW),
    "hp before the removal",
  );

  h.debug.removePassive(slot);
  const removed = h.snapshot();
  assertEqual(removed.run.maxHp, BASE_MAX_HP, "run.maxHp at the call");
  assertEqual(removed.run.player.hp, maxHpOf(TALLOW), "player.hp at the call");

  const capped = await advanceTicks(h, 1);
  captureStill(h, "capped");
  assertEqual(
    capped.run.player.hp,
    BASE_MAX_HP,
    "player.hp after the next tick",
  );
});
