// Wick — instrumentation/set-next-spawn-angle: `setNextSpawnAngle(30)` on
// `playing` sets `nextSpawnAngle` to 30, the snapshot reads it back, and the
// next window spawn lands on the ring at that angle.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes", `setNextSpawnAngle(degrees)`): "Sets `nextSpawnAngle` to
// `degrees`, a real number of at least `0` and below `360`, measured from
// `+x` toward `+y` ... The next spawn point the director draws, for a window
// spawn or a scripted elite, is at that angle as `specs/enemies.md` states".
// `specs/enemies.md` ("The spawn ring"): "`x = player.x + cos(angle) *
// SPAWN_DISTANCE`, `y = player.y + sin(angle) * SPAWN_DISTANCE`".
//
// THE POSE. An isolated night in window 0 with the timer posed due, so the
// first tick with `spawning` on lands one window spawn; `enemyMotion` is off,
// so the arrival is read where it arrived. The lamplighter stands off the
// origin, so the point is read as center plus offset rather than offset
// alone.
//
// THE TOLERANCE. `REAL_EPS` on the point, `cos` and `sin` of one angle scaled
// by 760.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { REAL_EPS, SPAWN_DISTANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  pointAt,
  type Harness,
} from "../harness";

const POSED_ANGLE = 30;
const PLAYER_AT = { x: 120, y: -40 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the next spawn's angle, and the spawn lands there", async () => {
  isolate(h);
  h.debug.setPlayerPosition(PLAYER_AT.x, PLAYER_AT.y);
  h.debug.setNextSpawnAngle(POSED_ANGLE);
  assertEqual(
    h.snapshot().run.nextSpawnAngle,
    POSED_ANGLE,
    "nextSpawnAngle after the pose",
  );

  h.debug.setSpawnTimer(0);
  enable(h, "spawning");
  const spawned = await h.tick(1);
  captureStill(h, "spawned");

  assertLength(spawned.run.enemies, 1, "enemies the due tick spawned");
  const expected = pointAt(PLAYER_AT, POSED_ANGLE, SPAWN_DISTANCE);
  const [arrival] = spawned.run.enemies;
  assertNear(
    arrival.x,
    expected.x,
    REAL_EPS,
    "the spawn's x at the posed angle",
  );
  assertNear(
    arrival.y,
    expected.y,
    REAL_EPS,
    "the spawn's y at the posed angle",
  );
});
