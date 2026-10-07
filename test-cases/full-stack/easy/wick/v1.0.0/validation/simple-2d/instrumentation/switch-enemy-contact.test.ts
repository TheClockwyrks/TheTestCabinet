// instrumentation/switch-enemy-contact — with `setEnemyContact(false)`, a
// moth overlapping the lamplighter with its cooldown due lands no hit over 60
// ticks and hp holds, while a posed contactCooldown still counts down to 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `enemyContact` off: "No enemy hits. Every `contactCooldown` still
// counts down". specs/world.md, "Contact damage": an overlapping enemy "whose
// `contactCooldown` is due lands a hit", and "The cooldown counts down on
// every tick the enemy is alive, in or out of contact"; a 0.5 s timer is due
// 30 ticks on and held at 0.
//
// THE POSE. An isolated run, two moths overlapping the lamplighter: one with
// its cooldown at 0, due on every tick, and one posed to 0.5. Sixty ticks with
// the switch off: hp reads BASE_MAX_HP still, and the posed cooldown reads 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const HELD_TICKS = 60;
const POSED_COOLDOWN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands no hit while off, the cooldowns still counting", async () => {
  isolate(h);
  const due = spawnEnemyAt(h, "moth", 5, 0);
  const cooling = spawnEnemyAt(h, "moth", -5, 0);
  h.debug.setEnemyContactCooldown(cooling, POSED_COOLDOWN);
  assertEqual(
    enemyById(h.snapshot(), due)?.contactCooldown,
    0,
    "the due moth's cooldown",
  );

  const held = await h.tick(HELD_TICKS);
  captureStill(h, "held");

  assertEqual(held.run.player.hp, BASE_MAX_HP, "hp after 60 ticks of overlap");
  assertEqual(
    enemyById(held, cooling)?.contactCooldown,
    0,
    "the posed cooldown, counted down to 0 while the switch was off",
  );
});
