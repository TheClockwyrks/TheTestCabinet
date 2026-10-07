// director/gnats-despawn — a gnat is a common, and the distance rule takes it.
//
// THE SPEC LINE. `specs/enemies.md`, "Despawning": "every common enemy whose
// center is farther than `DESPAWN_DISTANCE` (`1200`) units from the
// lamplighter's center is removed ... Gnats are common and despawn the same
// way." The roster gives `gnat` rank `common`, and "The cap" excuses gnats
// from the SPAWN cap alone — "Gnats, the elites, and the Dark stand outside
// the cap" — which is a different rule. A build that read one exemption as the
// other keeps its gnats forever, and the swarms that arrive three times a
// night never leave the field.
//
// WHERE THE GNAT STANDS. 1300 units out along `+x`, a hundred past the
// boundary: far enough that a build removing at any threshold near the stated
// one still removes it, so what this item decides is whether the gnat is
// subject to the rule at all rather than where the rule's edge lies.
//
// THE DRIVE. The isolated world with `despawning` alone on and one tick, the
// same drive the moth of the beyond-the-distance item takes, so that the only
// thing that differs between the two is the type.
//
// THE TOLERANCE. None: the gnat is in the next snapshot or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertUndefined } from "../assert";
import { DESPAWN_DISTANCE } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** A hundred units past the boundary. */
const BEYOND = DESPAWN_DISTANCE + 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a gnat 1300 units out on the next tick with despawning on", async () => {
  isolate(h);
  const gnat = placeEnemyNear(h, "gnat", BEYOND, 0);
  enable(h, "despawning");

  const after = await advanceTicks(h, 1);
  captureStill(h, "gnat");

  assertUndefined(
    enemyById(after, gnat),
    `the gnat posed ${BEYOND} units out, after one tick with despawning on`,
  );
});
