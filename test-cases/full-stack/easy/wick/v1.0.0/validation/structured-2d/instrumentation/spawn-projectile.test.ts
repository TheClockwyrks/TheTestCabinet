// Wick — instrumentation/spawn-projectile: `spawnProjectile('ember', 100, 0,
// 400, 0, 0)` appears at (100, 0) with velocity (400, 0), acceleration (0, 0),
// pierce 0, empty hits, and the next id, and with `effectMotion` on it first
// moves on the next tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnProjectile(weapon, x, y, vx, vy, pierce)`: "Adds one projectile of
// `weapon` ... centered at `(x, y)` with velocity `(vx, vy)` ... and `pierce`
// ... `hits` is empty ... every other weapon takes `(0, 0)`"; "A pose that
// creates an entity gives it the next id from `nextId`, and a posed ...
// projectile ... first moves ... on the next tick". `specs/world.md`, phase
// 6: "a projectile's position advances by its velocity times `TICK_DT`" —
// 400/60 along +x (`MOTION_EPS`).
//
// THE DRIVE. An isolated run, the id read off `nextId`, the pose read at the
// call, `effectMotion` on, one tick.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertNear,
} from "../assert";
import { MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

const X = 100;
const VX = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("adds the posed bolt and it flies from the next tick", async () => {
  isolate(h);
  const expectedId = h.snapshot().run.nextId;
  const id = placeProjectile(h, "ember", X, 0, VX, 0, 0);
  const posed = projectileById(h.snapshot(), id);
  assertEqual(id, expectedId, "the id the bolt took");
  assertDefined(posed, "the posed bolt");
  if (posed === undefined) return;
  assertEqual(posed.weapon, "ember", "its weapon");
  assertEqual(posed.x, X, "its x");
  assertEqual(posed.y, 0, "its y");
  assertEqual(posed.vx, VX, "its vx");
  assertEqual(posed.vy, 0, "its vy");
  assertEqual(posed.ax, 0, "its ax");
  assertEqual(posed.ay, 0, "its ay");
  assertEqual(posed.pierce, 0, "its pierce");
  assertDeepEqual(posed.hits, [], "its hits");

  enable(h, "effectMotion");
  const moved = projectileById(
    await captureReplay(h, "flight", () => advanceTicks(h, 1)),
    id,
  );
  assertDefined(moved, "the bolt after one tick");
  assertNear(
    moved?.x ?? Number.NaN,
    X + VX * TICK_DT,
    MOTION_EPS,
    "its x after one moving tick",
  );
  assertEqual(moved?.y, 0, "its y after one moving tick");
});
