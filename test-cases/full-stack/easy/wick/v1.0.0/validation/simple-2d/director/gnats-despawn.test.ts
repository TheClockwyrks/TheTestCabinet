// director/gnats-despawn — a gnat past `DESPAWN_DISTANCE` is removed like any
// other common.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Despawning"): "every common enemy whose center is
//     farther than `DESPAWN_DISTANCE` (`1200`) units from the lamplighter's
//     center is removed ... Gnats are common and despawn the same way."
//   - `specs/enemies.md` ("The roster"): the Gnat is rank `common`, and
//     ("The cap"): "Gnats, the elites, and the Dark stand outside the cap", the
//     one rule gnats do stand outside.
//
// WHAT IS READ. A gnat posed 1300 units from the lamplighter and one tick of
// despawning: the gnat must be gone. A build that read "outside the cap" as
// "outside the director" keeps it.
//
// WHY THE NIGHT IS POSED AS IT IS. `despawning` alone is on, so nothing else
// can remove the gnat, and `enemyMotion` is off, so a drifter cannot travel out
// of or into the distance the reading is about.
//
// TOLERANCE. None: the gnat is on the field or gone.

import { afterEach, beforeEach, it } from "vitest";
import { assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

/** Where the gnat is posed: 1300 units out, past the 1200 a removal takes. */
const BEYOND = 1300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a gnat past DESPAWN_DISTANCE", async () => {
  isolate(h);
  enable(h, "despawning");
  const gnat = spawnEnemyAt(h, "gnat", BEYOND, 0);

  const after = await h.tick(1);
  captureStill(h, "gnat");

  assertUndefined(enemyById(after, gnat), "the gnat posed 1300 units out");
});
