// Wick — instrumentation/spawn-enemy-heading: a gnat spawned at (300, 400)
// with the lamplighter at the origin carries the unit heading (−0.6, −0.8).
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnEnemy(type, x, y)`: "its heading is the one `specs/enemies.md` gives a
// spawn at that point, the unit vector toward the lamplighter's center";
// `specs/enemies.md`, "The life of an enemy": "the unit vector from its spawn
// point to the lamplighter's center". From (300, 400) to (0, 0): (−300, −400)
// over 500. `REAL_EPS` on the two quotients.
//
// THE POSE. An isolated run with the lamplighter at the origin, the spawn,
// read at the call. A gnat, a drifter, so the heading read is the one the
// spawn gave rather than one a chaser would recompute; no tick runs anyway.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  unit,
  type Harness,
} from "../harness";

const SPAWN_X = 300;
const SPAWN_Y = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("aims the spawn's heading at the lamplighter", async () => {
  isolate(h);
  const id = placeEnemy(h, "gnat", SPAWN_X, SPAWN_Y);
  const gnat = enemyById(h.snapshot(), id);
  await h.frameDraw();
  captureStill(h, "aimed");

  assertDefined(gnat, "the spawned gnat");
  if (gnat === undefined) return;
  const expected = unit(-SPAWN_X, -SPAWN_Y);
  assertNear(
    gnat.heading.x,
    expected.x,
    REAL_EPS,
    "heading.x of a spawn at (300, 400)",
  );
  assertNear(
    gnat.heading.y,
    expected.y,
    REAL_EPS,
    "heading.y of a spawn at (300, 400)",
  );
});
