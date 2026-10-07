// Wick — instrumentation/switch-despawning: with `setDespawning(false)`, a
// moth posed 1300 units from the lamplighter stays alive across 60 ticks; with
// the switch back on it is removed on the next tick.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setDespawning(on)` | `despawning` | Commons beyond
// `DESPAWN_DISTANCE` are removed. | Nothing is removed by distance."
// specs/enemies.md — "Despawning": "Each tick `despawning` is on, every common
// enemy whose center is farther than `DESPAWN_DISTANCE` (`1200`) units from
// the lamplighter's center is removed". 1300 is past that distance.
//
// WHY THE WORLD IS POSED AS IT IS. One moth, past the distance, with
// `enemyMotion` held so it cannot walk back inside it; every other faculty
// held, so its removal on the resumed tick is the director's alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DESPAWN_DISTANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_DISTANCE = DESPAWN_DISTANCE + 100;
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds distance removal while off, and removes on the next tick once on", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", POSED_DISTANCE, 0);

  const held = await h.step(HELD_TICKS);
  await captureStill(h, "held");
  assertEqual(
    enemyById(held, moth.id) !== undefined,
    true,
    `the distant moth alive after ${HELD_TICKS} ticks with despawning off`,
  );

  await h.debug.setDespawning(true);
  const resumed = await h.step(1);
  assertEqual(
    enemyById(resumed, moth.id),
    undefined,
    "the distant moth after one tick with despawning on",
  );
});
