// Wick — instrumentation/spawn-projectile-sconce-decel:
// `spawnProjectile("sconce", 0, 0, 0, 600, -1)` reads acceleration
// `(0, -600)`, and a posed ember, pin, shard, beacon, or hail reads `(0, 0)`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnProjectile(...)`): "A `sconce` takes acceleration `−SCONCE_DECEL`
// along the unit vector of `(vx, vy)` ...; every other weapon takes `(0, 0)`",
// with `SCONCE_DECEL` (`600`). Along `(0, 600)` the unit vector is `(0, 1)`,
// so the acceleration is `(0, -600)`, read to `FLOAT_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. The sconce is launched straight down so the
// expected vector is exact; every other projectile weapon is posed once with a
// non-zero velocity, so a build that gave any of them the sconce's rule fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  FLOAT_TOL,
  INFINITE_PIERCE,
  PROJECTILE_WEAPONS,
  SCONCE_DECEL,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeProjectile,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives a posed sconce its deceleration, and every other weapon none", async () => {
  await isolate(h);
  const sconce = await placeProjectile(
    h,
    "sconce",
    0,
    0,
    0,
    600,
    INFINITE_PIERCE,
  );
  assertNear(sconce.ax, 0, FLOAT_TOL, "the sconce's ax");
  assertNear(sconce.ay, -SCONCE_DECEL, FLOAT_TOL, "the sconce's ay");

  for (const weapon of PROJECTILE_WEAPONS) {
    if (weapon === "sconce") continue;
    const shape = await placeProjectile(h, weapon, 100, 100, 100, 0, 0);
    assertEqual(shape.ax, 0, `a posed ${weapon}'s ax`);
    assertEqual(shape.ay, 0, `a posed ${weapon}'s ay`);
  }
  await captureStill(h, "decel");
});
