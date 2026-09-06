// Wick — instrumentation/set-next-spawn-angle: `setNextSpawnAngle(30)` on
// `playing` sets `nextSpawnAngle` to 30, the snapshot reads it back, and the
// next window spawn lands on the ring at that angle.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextSpawnAngle(degrees)`): "Sets `nextSpawnAngle` to
// `degrees`, a real number of at least `0` and below `360`, measured from `+x`
// toward `+y` ... The next spawn point the director draws, for a window spawn
// or a scripted elite, is at that angle as `specs/enemies.md` states".
// specs/enemies.md ("The spawn ring"): "`x = player.x + cos(angle) *
// SPAWN_DISTANCE`, `y = player.y + sin(angle) * SPAWN_DISTANCE`".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night in window 0 with an empty
// field and the timer posed due, so the first tick with `spawning` on lands
// one window spawn; `enemyMotion` is off, so the arrival is read where it
// arrived. The lamplighter stands off the origin, so the point is read as
// center plus offset rather than offset alone.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` a position is allowed: the point
// is `cos` and `sin` of one angle scaled by 760.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { POSITION_TOL, SPAWN_DISTANCE } from "../constants";
import {
  alongAngle,
  captureStill,
  createHarness,
  isolate,
  newEnemies,
  type Harness,
} from "../harness";

const POSED_ANGLE = 30;
const PLAYER_AT = { x: 120, y: -40 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the next spawn's angle, and the spawn lands there", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(PLAYER_AT.x, PLAYER_AT.y);
  await h.debug.setNextSpawnAngle(POSED_ANGLE);
  const posed = await h.snapshot();
  assertEqual(
    posed.run.nextSpawnAngle,
    POSED_ANGLE,
    "nextSpawnAngle after the pose",
  );

  await h.debug.setSpawnTimer(0);
  await h.debug.setSpawning(true);
  const spawned = await h.step(1);
  await captureStill(h, "spawned");

  const arrivals = newEnemies(posed, spawned);
  assertLength(arrivals, 1, "enemies the due tick spawned");
  const expected = alongAngle(PLAYER_AT, POSED_ANGLE, SPAWN_DISTANCE);
  assertNear(
    arrivals[0]!.x,
    expected.x,
    POSITION_TOL,
    "the spawn's x at the posed angle",
  );
  assertNear(
    arrivals[0]!.y,
    expected.y,
    POSITION_TOL,
    "the spawn's y at the posed angle",
  );
});
