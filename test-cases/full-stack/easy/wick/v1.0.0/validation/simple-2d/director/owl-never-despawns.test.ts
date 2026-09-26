// director/owl-never-despawns — an Owl at any distance stays on the field
// while despawning runs.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Despawning"): "every common enemy whose center is
//     farther than `DESPAWN_DISTANCE` (`1200`) units from the lamplighter's
//     center is removed ... Elites and the Dark are outside this rule and stay
//     on the field at any distance."
//   - `specs/enemies.md` ("Elites and the Dark"): "each stays on the field
//     however far the lamplighter travels, until it dies or the run ends", and
//     the Owl is rank `elite`.
//   - `specs/instrumentation.md` (`setEnemyMotion`): while off, "Every enemy
//     holds its position and heading", so the posed distance is the distance on
//     every tick of the stretch.
//
// WHAT IS READ. An Owl, posed 3000 units from the lamplighter, more than
// twice the distance that removes a common, held still across 60 ticks of
// despawning: it must still be on the field. A build that applies the removal
// to every rank alike loses it on the first tick.
//
// WHY THE NIGHT IS POSED AS IT IS. `despawning` alone is on, so the only rule
// that could take it off the field is the one under test; `enemyMotion` is off,
// so it cannot close the distance and pass the reading by walking in.
//
// TOLERANCE. None: it is on the field or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

/** Where it is posed: 3000 units out, far past the 1200 that removes a common. */
const FAR = 3000;

/** Ticks the distance is held across. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps an owl 3000 units out across 60 ticks of despawning", async () => {
  isolate(h);
  enable(h, "despawning");
  const posed = spawnEnemyAt(h, "owl", FAR, 0);

  const after = await h.tick(HELD_TICKS);
  captureStill(h, "kept");

  assertDefined(
    enemyById(after, posed),
    "the Owl posed 3000 units out, after 60 ticks of despawning",
  );
});
