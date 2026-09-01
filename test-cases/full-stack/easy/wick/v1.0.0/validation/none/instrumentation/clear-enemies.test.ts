// Wick — instrumentation/clear-enemies: `clearEnemies()` with moths, a
// mothwing, and the Dark alive leaves `enemies` empty, `kills` unchanged, and
// no gem or pickup dropped.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `clearEnemies()`): "Removes every enemy, elites and the Dark included, the
// same way" — the way `removeEnemy` does, where "Nothing drops, nothing
// counts as a kill".
//
// WHY THE WORLD IS POSED AS IT IS. Every rank on the field, since the sentence
// names the elites and the Dark; a kill count that is not `0`, so a count
// that rose is plain; an elite's drop would be a chest and a common's a gem,
// so both lists are read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_KILLS = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every enemy with no outcome", async () => {
  await isolate(h);
  await h.debug.setKills(POSED_KILLS);
  await placeEnemy(h, "moth", 200, 0);
  await placeEnemy(h, "moth", -200, 0);
  await placeEnemy(h, "mothwing", 0, 300);
  await placeEnemy(h, "dark", 0, -400);
  assertLength(
    (await h.snapshot()).run.enemies,
    4,
    "the enemies before the clear",
  );

  await h.debug.clearEnemies();
  const after = await h.snapshot();
  await captureStill(h, "cleared");

  assertLength(after.run.enemies, 0, "the enemies after clearEnemies()");
  assertEqual(after.run.kills, POSED_KILLS, "kills across the clear");
  assertLength(after.run.gems, 0, "gems dropped by the clear");
  assertLength(after.run.pickups, 0, "pickups dropped by the clear");
});
