// Wick — instrumentation/spawn-projectile: `spawnProjectile("ember", 100, 0,
// 400, 0, 0)` appears in the snapshot at `(100, 0)` with velocity `(400, 0)`,
// acceleration `(0, 0)`, `pierce` 0, empty `hits`, and the next id, and with
// `effectMotion` on it first moves on the next tick.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnProjectile(weapon, x, y, vx, vy, pierce)`): "Adds one projectile of
// `weapon` ... centered at `(x, y)` with velocity `(vx, vy)` in units per
// second and `pierce` ...; `hits` is empty ... every other weapon takes
// `(0, 0)`" as acceleration; "A pose that creates an entity gives it the next
// id"; "a posed ... projectile ... first moves ... on the next tick".
// specs/world.md phase 6: "a projectile's position advances by its velocity
// times `TICK_DT`", 400/60 units here, read to `POSITION_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. An empty night, so the next id is the one
// the snapshot held before the call and nothing is in the bolt's path.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { POSITION_TOL, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustProjectile,
  placeProjectile,
  type Harness,
} from "../harness";

const BOLT = { x: 100, y: 0, vx: 400, vy: 0, pierce: 0 };

/** Frames of flight recorded after the first step. */
const FLIGHT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds a posed projectile with the next id, which first moves on the next tick", async () => {
  await isolate(h);
  const before = await h.snapshot();

  const bolt = await placeProjectile(
    h,
    "ember",
    BOLT.x,
    BOLT.y,
    BOLT.vx,
    BOLT.vy,
    BOLT.pierce,
  );
  assertEqual(bolt.id, before.run.nextId, "the bolt's id, the next id");
  assertEqual(bolt.weapon, "ember", "the bolt's weapon");
  assertNear(bolt.x, BOLT.x, POSITION_TOL, "the bolt's x at the pose");
  assertNear(bolt.y, BOLT.y, POSITION_TOL, "the bolt's y at the pose");
  assertNear(bolt.vx, BOLT.vx, POSITION_TOL, "the bolt's vx");
  assertNear(bolt.vy, BOLT.vy, POSITION_TOL, "the bolt's vy");
  assertEqual(bolt.ax, 0, "the bolt's ax");
  assertEqual(bolt.ay, 0, "the bolt's ay");
  assertEqual(bolt.pierce, BOLT.pierce, "the bolt's pierce");
  assertDeepEqual(bolt.hits, [], "the bolt's hits");

  await h.debug.setEffectMotion(true);
  const first = await captureReplay(h, "flight", async () => {
    const stepped = await h.step(1);
    await h.step(FLIGHT_FRAMES);
    return stepped;
  });
  const moved = mustProjectile(first, bolt.id);
  assertNear(
    moved.x,
    BOLT.x + BOLT.vx * TICK_DT,
    POSITION_TOL,
    "the bolt's x after its first tick",
  );
  assertNear(
    moved.y,
    BOLT.y + BOLT.vy * TICK_DT,
    POSITION_TOL,
    "the bolt's y after its first tick",
  );
});
