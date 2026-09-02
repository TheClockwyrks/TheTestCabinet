// instrumentation/spawn-projectile — `spawnProjectile('ember', 100, 0, 400,
// 0, 0)` appears in the snapshot at (100, 0) with velocity (400, 0),
// acceleration (0, 0), pierce 0, empty hits, and the next id, and with
// effectMotion on it first moves on the next tick.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnProjectile`:
// "Adds one projectile of `weapon` ... centered at `(x, y)` with velocity
// `(vx, vy)` in units per second and `pierce` ... `hits` is empty ... every
// other weapon takes `(0, 0)`" acceleration; "A pose that creates an entity
// gives it the next id ... a posed ... projectile ... first moves ... on the
// next tick". specs/world.md, phase 6: "a projectile's position advances by
// its velocity times `TICK_DT`".
//
// THE POSE. An isolated run, the spawn, the read back without a frame,
// `effectMotion` on, and one tick: x is 100 + 400 × TICK_DT.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertWithin,
} from "../assert";
import { MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  projectileById,
  type Harness,
} from "../harness";

const AT = { x: 100, y: 0 };
const V = { x: 400, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds the bolt as posed, and it flies from the next tick", async () => {
  isolate(h);
  const nextId = h.snapshot().run.nextId;

  h.debug.spawnProjectile("ember", AT.x, AT.y, V.x, V.y, 0);
  const s = h.snapshot();
  const bolt = projectileById(s, nextId);
  assertDefined(bolt, "the bolt under the next id");
  assertEqual(s.run.nextId, nextId + 1, "nextId after the spawn");
  assertEqual(bolt?.weapon, "ember", "its weapon");
  assertEqual(bolt?.x, AT.x, "its x");
  assertEqual(bolt?.y, AT.y, "its y");
  assertEqual(bolt?.vx, V.x, "its vx");
  assertEqual(bolt?.vy, V.y, "its vy");
  assertEqual(bolt?.ax, 0, "its ax");
  assertEqual(bolt?.ay, 0, "its ay");
  assertEqual(bolt?.pierce, 0, "its pierce");
  assertDeepEqual(bolt?.hits, [], "its hits");

  enable(h, "effectMotion");
  const moved = await captureReplay(h, "flight", () => h.tick(1));
  assertWithin(
    projectileById(moved, nextId)?.x ?? Number.NaN,
    AT.x + V.x * TICK_DT,
    MOTION_TOLERANCE,
    "its x after the first tick",
  );
});
