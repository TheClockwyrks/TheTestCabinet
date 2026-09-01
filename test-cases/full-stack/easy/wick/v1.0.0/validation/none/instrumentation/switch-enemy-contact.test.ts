// Wick — instrumentation/switch-enemy-contact: with `setEnemyContact(false)`,
// a moth overlapping the lamplighter with its cooldown due lands no hit over
// 60 ticks and `hp` holds, while a posed `contactCooldown` still counts down
// to `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setEnemyContact(on)` | `enemyContact` | An overlapping enemy
// whose cooldown is due hits. | No enemy hits. Every `contactCooldown` still
// counts down." specs/world.md — "Contact damage": circles overlap "when the
// distance between their centers is less than the enemy's radius plus
// `PLAYER_RADIUS`"; a timer set to 0.5 s is due 30 ticks on and "held at `0`".
//
// WHY THE WORLD IS POSED AS IT IS. One moth at 5 units, well inside the
// overlap distance, with its cooldown posed to half a second so its counting
// to `0` is visible within the 60 held ticks; `enemyMotion` and every other
// faculty held, so the moth stays overlapping and nothing else touches `hp`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

const HELD_TICKS = 60;
const POSED_COOLDOWN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every hit while off, the cooldowns still counting", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", 5, 0);
  await h.debug.setEnemyContactCooldown(moth.id, POSED_COOLDOWN);

  const held = await h.step(HELD_TICKS);
  await captureStill(h, "held");

  assertEqual(
    held.run.player.hp,
    BASE_MAX_HP,
    `hp after ${HELD_TICKS} ticks with enemyContact off`,
  );
  assertEqual(
    mustEnemy(held, moth.id).contactCooldown,
    0,
    `the posed contact cooldown after ${HELD_TICKS} held ticks`,
  );
});
