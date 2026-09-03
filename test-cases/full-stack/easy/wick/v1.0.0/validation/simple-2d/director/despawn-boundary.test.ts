// director/despawn-boundary — a common at exactly `DESPAWN_DISTANCE` stays on
// the field.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Despawning"): "every common enemy whose center is
//     farther than `DESPAWN_DISTANCE` (`1200`) units from the lamplighter's
//     center is removed". Farther than, so 1200 itself is not.
//   - `specs/instrumentation.md` (`setEnemyMotion`): while off, "Every enemy
//     holds its position and heading", so the posed distance is the distance
//     read on every tick of the stretch.
//
// WHAT IS READ. A moth posed exactly 1200 units from the lamplighter, held
// still, across 60 ticks of despawning: it must be on the field at the end. A
// build whose removal takes "at least 1200" removes it on the first tick.
//
// WHY THE NIGHT IS POSED AS IT IS. `despawning` alone is on, so the only thing
// that could remove the moth is the rule under test; `enemyMotion` is off, so
// the moth cannot walk off the boundary and make the reading depend on the
// tick it is taken at.
//
// TOLERANCE. None on the reading: the moth is on the field or it is not. The
// distance is posed exactly, one coordinate at 1200 and the other at 0, so no
// rounding stands between the pose and the boundary.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertWithin } from "../assert";
import { DESPAWN_DISTANCE, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  enable,
  enemyById,
  isolate,
  present,
  spawnEnemyAt,
  type Harness,
} from "../harness";

/** Ticks the boundary is held across. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps a common at exactly DESPAWN_DISTANCE", async () => {
  isolate(h);
  enable(h, "despawning");
  const moth = spawnEnemyAt(h, "moth", DESPAWN_DISTANCE, 0);

  const after = await h.tick(HELD_TICKS);
  captureStill(h, "boundary");

  assertDefined(
    enemyById(after, moth),
    "the moth at exactly 1200 units, after 60 ticks of despawning",
  );
  assertWithin(
    distance(present(enemyById(after, moth), "the moth"), after.run.player),
    DESPAWN_DISTANCE,
    FIGURE_TOLERANCE,
    "the distance it was held at",
  );
});
