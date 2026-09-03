// Wick — instrumentation/set-player-position-leaves-the-rest: after
// `setPlayerPosition`, every enemy, projectile, zone, gem, and pickup holds the
// position it had, and `facing` and `hp` are untouched.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setPlayerPosition(x, y)`): "Sets the lamplighter's center to `(x, y)`.
// Nothing else moves". The comparison is exact equality of the documented run
// with the lamplighter's `x` and `y` set aside.
//
// WHY THE WORLD IS POSED AS IT IS. One entity of every kind, a turned and hurt
// lamplighter, and no tick between the pose and the read, so a build that
// moved the world with the camera, or reset the lamplighter's other fields
// with its position, is caught on that field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";

const POSED = { x: 300, y: -120 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves nothing but the lamplighter", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", 200, 0);
  await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  await placePuddle(h, "oil-splash", 50, 50);
  await placeGem(h, "medium", -200, 0);
  await placePickup(h, "bread", 0, -200);
  await h.debug.setFacing("left");
  await h.debug.setHp(40);
  const before = await h.snapshot();

  await h.debug.setPlayerPosition(POSED.x, POSED.y);
  const after = await h.snapshot();
  await captureStill(h, "held");

  assertEqual(after.run.player.x, POSED.x, "player.x after the pose");
  assertEqual(after.run.player.y, POSED.y, "player.y after the pose");
  const rest = documentedRun(after.run);
  rest.player = {
    ...(rest.player as Record<string, unknown>),
    x: before.run.player.x,
    y: before.run.player.y,
  };
  assertDeepEqual(
    rest,
    documentedRun(before.run),
    "the run beside the lamplighter's position, across the pose",
  );
});
