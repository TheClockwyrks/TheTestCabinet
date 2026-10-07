// director/despawn-beyond-distance — a common farther than `DESPAWN_DISTANCE`
// from the lamplighter is removed, and leaves nothing behind.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Despawning"): "Each tick `despawning` is on, every
//     common enemy whose center is farther than `DESPAWN_DISTANCE` (`1200`)
//     units from the lamplighter's center is removed: no gem, no kill, no cue,
//     and every re-hit entry naming it dropped."
//   - `specs/enemies.md` ("The roster"): the Moth is rank `common`.
//   - `specs/world.md` ("One tick"), phase 10: the director runs on the tick,
//     "despawning while `despawning` is on".
//
// WHAT IS READ. A moth posed 1201 units from the lamplighter, one unit past the
// distance, and one tick: the moth must be gone, `kills` must stand where it
// was posed, no gem may be on the field, and no `kill` cue may have sounded. A
// build that despawns but counts the removal as a death fails on the count or
// the drop rather than on the removal.
//
// WHY THE NIGHT IS POSED AS IT IS. `despawning` alone is on: `enemyMotion` is
// off so the moth stands exactly where it was posed when the distance is read,
// nothing fires at it, and nothing else is on the field to be removed.
//
// TOLERANCE. None: the moth is either on the field or gone, and the count and
// the drops are counted exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import { DESPAWN_DISTANCE } from "../constants";
import {
  captureStill,
  createHarness,
  cuesNamed,
  enable,
  enemyById,
  isolate,
  onCue,
  spawnEnemyAt,
  type Harness,
} from "../harness";

/** One unit past the distance a removal takes: 1201. */
const BEYOND = DESPAWN_DISTANCE + 1;

/** A kill count posed before the tick, so a miscounted removal shows. */
const POSED_KILLS = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a common past DESPAWN_DISTANCE and leaves nothing behind", async () => {
  isolate(h);
  enable(h, "despawning");
  h.debug.setKills(POSED_KILLS);
  const moth = spawnEnemyAt(h, "moth", BEYOND, 0);
  const cues = onCue(h);

  const after = await h.tick(1);
  captureStill(h, "removed");

  assertUndefined(enemyById(after, moth), "the moth posted past 1200 units");
  assertEqual(after.run.kills, POSED_KILLS, "kills across the removal");
  assertLength(after.run.gems, 0, "gems dropped by the removal");
  assertLength(cuesNamed(cues, "kill"), 0, "kill cues across the removal");
});
