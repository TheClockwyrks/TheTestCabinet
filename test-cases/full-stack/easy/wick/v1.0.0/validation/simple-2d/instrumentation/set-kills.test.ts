// instrumentation/set-kills — `setKills(250)` reads back kills 250, and the
// next kill reads 251.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setKills`: "Sets
// `kills` to `kills`, a whole number of at least `0`". specs/enemies.md, "The
// life of an enemy": "On any tick that leaves `hp` at or below `0` the enemy
// dies on that tick: it is removed, the kill count rises by one".
//
// THE POSE. An isolated run, the pose read back, then a moth (5 hp) with an
// Ember bolt (10 damage at level 1, unheld) posed on it: the next tick's hit
// kills it, and the count reads one more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const POSED_KILLS = 250;
const MOTH_AT = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the kill count, and the next kill adds one", async () => {
  isolate(h);
  h.debug.setKills(POSED_KILLS);
  assertEqual(h.snapshot().run.kills, POSED_KILLS, "kills read back");

  spawnEnemyAt(h, "moth", MOTH_AT.x, MOTH_AT.y);
  h.debug.spawnProjectile("ember", MOTH_AT.x, MOTH_AT.y, 0, 0, 0);
  const after = await h.tick(1);
  captureStill(h, "posed");

  assertLength(after.run.enemies, 0, "the moth, killed by the bolt");
  assertEqual(after.run.kills, POSED_KILLS + 1, "kills after the next kill");
});
