// Wick — instrumentation/set-enemy-heading: `setEnemyHeading(id, 3, 4)` on a
// gnat reads back heading `(0.6, 0.8)`, and with `enemyMotion` on the gnat
// advances along it on the next tick.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setEnemyHeading(id, hx, hy)`): "Sets enemy `id`'s heading to the unit
// vector of `(hx, hy)` ... A chaser or weaver recomputes its heading on its
// next move, so this poses a drifter." specs/enemies.md — "Drift": "A drifting
// enemy keeps the heading it spawned with ... and advances one step along it
// every tick", a step being "`speed * TICK_DT` units", 160/60 for a gnat. The
// unit vector is read to `FLOAT_TOL`, the step to `POSITION_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. The gnat is spawned off the axis the posed
// heading points along, so its spawn heading (toward the lamplighter) differs
// from the posed one and a build that ignored the pose moves the wrong way.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, POSITION_TOL, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED = { hx: 3, hy: 4 };
const UNIT = { x: 0.6, y: 0.8 };

/** Frames of drift recorded after the first step. */
const DRIFT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses a drifter's heading, and it advances along it", async () => {
  await isolate(h);
  const gnat = await placeEnemy(h, "gnat", -200, 100);

  await h.debug.setEnemyHeading(gnat.id, POSED.hx, POSED.hy);
  const headed = mustEnemy(await h.snapshot(), gnat.id);
  assertNear(headed.heading.x, UNIT.x, FLOAT_TOL, "the posed heading's x");
  assertNear(headed.heading.y, UNIT.y, FLOAT_TOL, "the posed heading's y");

  await h.debug.setEnemyMotion(true);
  const stepped = await captureReplay(h, "headed", async () => {
    const first = await h.step(1);
    await h.step(DRIFT_FRAMES);
    return first;
  });
  const moved = mustEnemy(stepped, gnat.id);
  const step = ENEMIES.gnat.speed * TICK_DT;
  assertNear(
    moved.x,
    headed.x + UNIT.x * step,
    POSITION_TOL,
    "the gnat's x after one tick along the heading",
  );
  assertNear(
    moved.y,
    headed.y + UNIT.y * step,
    POSITION_TOL,
    "the gnat's y after one tick along the heading",
  );
});
