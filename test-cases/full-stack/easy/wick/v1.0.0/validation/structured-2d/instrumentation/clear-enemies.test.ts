// Wick — instrumentation/clear-enemies: `clearEnemies()` with moths, a
// mothwing, and the Dark alive leaves `enemies` empty, kills unchanged, and no
// gem or pickup dropped.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `clearEnemies()`: "Removes every enemy, elites and the Dark included, the
// same way" — as `removeEnemy`: "Nothing drops, nothing counts as a kill, and
// no cue plays."
//
// THE POSE. An isolated run with two moths, a mothwing (whose death would
// drop a chest), and the Dark, kills posed to 4, the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  onCue,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_KILLS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("empties the field without kills, drops, or cues", async () => {
  isolate(h);
  h.debug.setKills(POSED_KILLS);
  placeEnemy(h, "moth", 300, 0);
  placeEnemy(h, "moth", -300, 0);
  placeEnemy(h, "mothwing", 0, 300);
  placeEnemy(h, "dark", 0, -300);
  assertLength(h.snapshot().run.enemies, 4, "enemies before the call");
  const played = onCue(h);

  h.debug.clearEnemies();
  const after = h.snapshot();
  const playedAtCall = played.length;
  await h.frameDraw();
  captureStill(h, "cleared");

  assertDeepEqual(after.run.enemies, [], "enemies after clearEnemies");
  assertEqual(after.run.kills, POSED_KILLS, "run.kills after clearEnemies");
  assertLength(after.run.gems, 0, "gems after clearEnemies");
  assertLength(after.run.pickups, 0, "pickups after clearEnemies");
  assertEqual(playedAtCall, 0, "cues played at the clearEnemies call");
});
