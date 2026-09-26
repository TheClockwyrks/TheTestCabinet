// instrumentation/clear-enemies — `clearEnemies()` with moths, a mothwing,
// and the Dark alive leaves enemies empty, kills unchanged, and no gem or
// pickup dropped.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `clearEnemies`:
// "Removes every enemy, elites and the Dark included, the same way", the same
// way being `removeEnemy`'s: "Nothing drops, nothing counts as a kill, and no
// cue plays".
//
// THE POSE. An isolated run with a posed kill count, two moths, a mothwing,
// and the Dark, the clear, and the read back without a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const POSED_KILLS = 17;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the field without a kill or a drop", async () => {
  isolate(h);
  h.debug.setKills(POSED_KILLS);
  spawnEnemyAt(h, "moth", 300, 0);
  spawnEnemyAt(h, "moth", 0, 300);
  spawnEnemyAt(h, "mothwing", -300, 0);
  spawnEnemyAt(h, "dark", 0, -400);
  assertLength(h.snapshot().run.enemies, 4, "the enemies before the clear");

  h.debug.clearEnemies();
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "cleared");

  assertLength(s.run.enemies, 0, "the enemies after the clear");
  assertEqual(s.run.kills, POSED_KILLS, "kills across the clear");
  assertLength(s.run.gems, 0, "the gems dropped");
  assertLength(s.run.pickups, 0, "the pickups dropped");
});
