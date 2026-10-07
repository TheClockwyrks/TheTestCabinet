// Wick — instrumentation/set-enemy-heading: `setEnemyHeading(id, 3, 4)` on a
// gnat reads back heading (0.6, 0.8), and with `enemyMotion` on the gnat
// advances along it on the next tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setEnemyHeading(id, hx, hy)`: "Sets enemy `id`'s heading to the unit
// vector of `(hx, hy)` ... this poses a drifter." `specs/enemies.md`, "Drift":
// "advances one step along it every tick", `speed × TICK_DT`, 160/60 for a
// gnat. `REAL_EPS` on the heading, `MOTION_EPS` on the one step.
//
// THE DRIVE. An isolated run, a gnat at (200, 0), the pose read at the call,
// `enemyMotion` on, one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertNear } from "../assert";
import { ENEMIES, MOTION_EPS, REAL_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  unit,
  type Harness,
} from "../harness";

const HX = 3;
const HY = 4;
const START_X = 200;
const START_Y = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the heading and the drifter follows it", async () => {
  isolate(h);
  const id = placeEnemy(h, "gnat", START_X, START_Y);
  h.debug.setEnemyHeading(id, HX, HY);
  const posed = enemyById(h.snapshot(), id);
  assertDefined(posed, "the gnat after the pose");
  const heading = unit(HX, HY);
  assertNear(
    posed?.heading.x ?? Number.NaN,
    heading.x,
    REAL_EPS,
    "heading.x after setEnemyHeading(id, 3, 4)",
  );
  assertNear(
    posed?.heading.y ?? Number.NaN,
    heading.y,
    REAL_EPS,
    "heading.y after setEnemyHeading(id, 3, 4)",
  );

  enable(h, "enemyMotion");
  const moved = enemyById(
    await captureReplay(h, "headed", () => advanceTicks(h, 1)),
    id,
  );
  assertDefined(moved, "the gnat after one tick");
  const step = ENEMIES.gnat.speed * TICK_DT;
  assertNear(
    moved?.x ?? Number.NaN,
    START_X + heading.x * step,
    MOTION_EPS,
    "its x after one drifting tick",
  );
  assertNear(
    moved?.y ?? Number.NaN,
    START_Y + heading.y * step,
    MOTION_EPS,
    "its y after one drifting tick",
  );
});
