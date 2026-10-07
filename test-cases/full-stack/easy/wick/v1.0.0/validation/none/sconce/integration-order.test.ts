// Wick — sconce/integration-order: a sconce advances by its velocity before
// its velocity changes.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "On each tick it moves, its position advances by its velocity
// times `TICK_DT`, and then its velocity changes by its acceleration times
// `TICK_DT`", and ("Sconce") a sconce's velocity falls "integrated per tick as
// Projectiles and pierce states, position first and then velocity";
// `specs/world.md` (phase 6) states the same order. Row 1 of `SCONCE_LEVELS`
// launches at speed `600` and `SCONCE_DECEL` is `600`, so the first moving
// tick moves the sconce `600 × TICK_DT` = `10` units from its launch point and
// then leaves it at `600 − 600 × TICK_DT` = `590` units per second. A build
// that changed the velocity first would move `590 × TICK_DT` = `9.8333` units
// on that tick, so the position is what separates the two orders and the
// velocity is read beside it.
//
// WHY THE WORLD IS POSED AS IT IS. The requirement is the order of one tick's
// two steps, so the night holds one sconce and nothing else, and `effectMotion`
// alone is turned back on so that exactly one moving tick runs. The sconce is
// posed rather than launched because `spawnProjectile` gives it the launch's
// own acceleration ("A `sconce` takes acceleration `−SCONCE_DECEL` along the
// unit vector of `(vx, vy)`", `specs/instrumentation.md`) and a posed launch
// takes no enemy to aim at; its direction is `+x` and its launch point the
// origin, where both figures are exact.
//
// TOLERANCE. `POSITION_TOL` on the distance moved and on each component of the
// velocity: `1e-6` is five orders under the `0.1667` units that separate the
// two integration orders on this tick, and four under the `10` units per
// second one tick of the deceleration is worth.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  distanceBetween,
  enable,
  isolate,
  mustProjectile,
  type Harness,
} from "../harness";
import {
  CENTER,
  LAUNCH_LINE,
  placeSconce,
  reachAfter,
  speedAfter,
} from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves a level-1 sconce 10 units on its first moving tick and leaves it at 590", async () => {
  await isolate(h);
  const posed = await placeSconce(h, CENTER, LAUNCH_LINE);
  await enable(h, "effectMotion");

  const moved = mustProjectile(await h.step(1), posed.id);
  await captureStill(h, "order");

  assertNear(
    distanceBetween(moved, CENTER),
    reachAfter(1),
    POSITION_TOL,
    "the units the sconce sits from its launch point after its first moving tick",
  );
  assertNear(
    moved.vx,
    speedAfter(1) * LAUNCH_LINE.x,
    POSITION_TOL,
    "the sconce's velocity along its launch direction after that tick",
  );
  assertNear(
    moved.vy,
    speedAfter(1) * LAUNCH_LINE.y,
    POSITION_TOL,
    "the sconce's velocity across its launch direction after that tick",
  );
});
