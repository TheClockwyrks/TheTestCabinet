// instrumentation/spawn-enemy-heading — a gnat spawned at (300, 400) with the
// lamplighter at the origin carries the unit heading (−0.6, −0.8).
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnEnemy`: "its
// heading is the one `specs/enemies.md` gives a spawn at that point, the unit
// vector toward the lamplighter's center". specs/enemies.md, "Drift": "Its
// heading is fixed at spawn: the unit vector from its spawn position to the
// lamplighter's center". From (300, 400) to (0, 0) that is (−300, −400) / 500.
//
// THE POSE. An isolated run with the lamplighter at the origin, the spawn,
// the read back without a frame, at DIRECTION_TOLERANCE.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertWithin } from "../assert";
import { DIRECTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyAt,
  unit,
  type Harness,
} from "../harness";

const AT = { x: 300, y: 400 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("aims the spawn at the lamplighter", async () => {
  const posed = isolate(h);
  const { x, y } = posed.run.player;

  const id = spawnEnemyAt(h, "gnat", AT.x, AT.y);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "aimed");

  const gnat = enemyById(s, id);
  assertDefined(gnat, "the gnat in the snapshot");
  const expected = unit(x - AT.x, y - AT.y);
  assertWithin(
    gnat?.heading.x ?? Number.NaN,
    expected.x,
    DIRECTION_TOLERANCE,
    "heading.x",
  );
  assertWithin(
    gnat?.heading.y ?? Number.NaN,
    expected.y,
    DIRECTION_TOLERANCE,
    "heading.y",
  );
});
