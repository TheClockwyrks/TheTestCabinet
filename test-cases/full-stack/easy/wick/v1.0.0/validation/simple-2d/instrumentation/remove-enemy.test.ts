// instrumentation/remove-enemy — `removeEnemy(id)` on a moth leaves that moth
// gone and every other enemy present, with kills unchanged, no gem or pickup
// dropped, and no cue played.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `removeEnemy`:
// "Removes enemy `id`. Nothing drops, nothing counts as a kill, and no cue
// plays". specs/ui.md: "A cue is played by a tick or a frame, never by a pose
// of the debug surface".
//
// THE POSE. An isolated run with a posed kill count and three enemies, the
// removal of the middle one, the read back without a frame, and the cue list
// watched across the call and across the frame after it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertUndefined,
} from "../assert";
import {
  captureStill,
  createHarness,
  cuesNamed,
  enemyById,
  isolate,
  onCue,
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

it("removes the one enemy and nothing else happens", async () => {
  isolate(h);
  h.debug.setKills(POSED_KILLS);
  const first = spawnEnemyAt(h, "moth", 300, 0);
  const removed = spawnEnemyAt(h, "moth", 0, 300);
  const third = spawnEnemyAt(h, "bat", -300, 0);
  const cues = onCue(h);

  h.debug.removeEnemy(removed);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "removed");

  assertUndefined(enemyById(s, removed), "the removed moth");
  assertDeepEqual(
    s.run.enemies.map((enemy) => enemy.id),
    [first, third],
    "the enemies left, in id order",
  );
  assertEqual(s.run.kills, POSED_KILLS, "kills across the removal");
  assertLength(s.run.gems, 0, "the gems dropped");
  assertLength(s.run.pickups, 0, "the pickups dropped");
  assertLength(
    cuesNamed(cues, "kill"),
    0,
    "kill cues across the removal and the frame after",
  );
});
