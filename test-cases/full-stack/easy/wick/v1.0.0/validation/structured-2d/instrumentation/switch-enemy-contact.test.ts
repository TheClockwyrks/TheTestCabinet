// Wick — instrumentation/switch-enemy-contact: with `setEnemyContact(false)`,
// a moth overlapping the lamplighter with its cooldown due lands no hit over
// 60 ticks and hp holds, while a posed `contactCooldown` still counts to 0.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// switch table, `enemyContact` off: "No enemy hits. Every `contactCooldown`
// still counts down." `specs/world.md`, "Contact damage": an overlapping enemy
// whose cooldown is due hits for `max(1, damage − armor)`; "Timers": 0.5 s
// counts to exactly 0 within 30 ticks and holds there.
//
// THE DRIVE. An isolated run, `enemyMotion` off, a moth spawned at the
// lamplighter's center (distance 0, overlapping) with a 0.5 s cooldown posed,
// and 60 ticks: hp exactly `BASE_MAX_HP`, the cooldown exactly 0.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

const HELD_TICKS = 60;
const POSED_COOLDOWN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands no hit while off, the cooldown counting all the same", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", 0, 0);
  h.debug.setEnemyContactCooldown(moth, POSED_COOLDOWN);
  const held = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "held");

  assertEqual(
    held.run.player.hp,
    BASE_MAX_HP,
    `hp after ${HELD_TICKS} ticks overlapped with enemyContact off`,
  );
  const enemy = enemyById(held, moth);
  assertDefined(enemy, "the overlapping moth");
  assertEqual(
    enemy?.contactCooldown,
    0,
    "the moth's contactCooldown counted to 0 while held",
  );
});
