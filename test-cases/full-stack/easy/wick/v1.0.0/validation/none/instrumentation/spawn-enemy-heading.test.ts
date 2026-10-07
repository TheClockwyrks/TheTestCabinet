// Wick — instrumentation/spawn-enemy-heading: a gnat spawned at `(300, 400)`
// with the lamplighter at the origin carries the unit heading `(-0.6, -0.8)`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnEnemy(type, x, y)`): "its heading is the one `specs/enemies.md` gives
// a spawn at that point, the unit vector toward the lamplighter's center".
// From `(300, 400)` to `(0, 0)` that is `(-300, -400) / 500`, read to
// `FLOAT_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. A 3-4-5 triangle, so the expected heading
// is exact in binary; a drifter, since a drifter keeps its spawn heading and a
// build is free to recompute a chaser's on its next move.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  unitToward,
  type Harness,
} from "../harness";

const AT = { x: 300, y: 400 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("aims the spawn at the lamplighter", async () => {
  const posed = await isolate(h);
  const expected = unitToward(AT, posed.run.player)!;

  const gnat = await placeEnemy(h, "gnat", AT.x, AT.y);
  await captureStill(h, "aimed");
  assertNear(gnat.heading.x, expected.x, FLOAT_TOL, "the spawn's heading x");
  assertNear(gnat.heading.y, expected.y, FLOAT_TOL, "the spawn's heading y");
});
