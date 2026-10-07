// instrumentation/spawn-enemy-heading-at-center — a gnat spawned exactly at
// the lamplighter's center while facing left carries the heading (−1, 0).
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnEnemy`: its
// heading is "the unit vector toward the lamplighter's center, or the facing
// direction when the two coincide". specs/weapons.md: "The facing direction
// is `facing` ...: `+x` for `"right"` and `-x` for `"left"`".
//
// THE POSE. An isolated run, `facing` posed to left, the gnat spawned at the
// lamplighter's own center, the read back without a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertDefined } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives a coincident spawn the facing direction", async () => {
  isolate(h);
  h.debug.setFacing("left");
  const { x, y } = h.snapshot().run.player;

  const id = spawnEnemyAt(h, "gnat", x, y);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "centered");

  const gnat = enemyById(s, id);
  assertDefined(gnat, "the gnat in the snapshot");
  assertDeepEqual(
    gnat?.heading,
    { x: -1, y: 0 },
    "the coincident spawn's heading",
  );
});
