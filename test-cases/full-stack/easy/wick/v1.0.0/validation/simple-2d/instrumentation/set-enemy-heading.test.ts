// instrumentation/set-enemy-heading — `setEnemyHeading(id, 3, 4)` on a gnat
// reads back heading (0.6, 0.8), and with enemyMotion on the gnat advances
// along it on the next tick.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setEnemyHeading`:
// "Sets enemy `id`'s heading to the unit vector of `(hx, hy)` ... this poses a
// drifter". specs/enemies.md, "Drift": a drifter "advances one step along it
// every tick", the step "`speed * TICK_DT` units", the gnat's speed 160.
//
// THE POSE. An isolated run, a gnat far from the lamplighter, the pose read
// back at DIRECTION_TOLERANCE, `enemyMotion` on, and one tick: the gnat at
// its position plus 160 × TICK_DT along (0.6, 0.8), at MOTION_TOLERANCE.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertWithin } from "../assert";
import {
  DIRECTION_TOLERANCE,
  ENEMIES,
  MOTION_TOLERANCE,
  TICK_DT,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyAt,
  unit,
  type Harness,
} from "../harness";

const AT = { x: 300, y: 0 };
const POSED = { x: 3, y: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the heading and the gnat drifts along it", async () => {
  isolate(h);
  const id = spawnEnemyAt(h, "gnat", AT.x, AT.y);

  h.debug.setEnemyHeading(id, POSED.x, POSED.y);
  const heading = enemyById(h.snapshot(), id)?.heading;
  assertDefined(heading, "the gnat's heading after the pose");
  const expected = unit(POSED.x, POSED.y);
  assertWithin(
    heading?.x ?? Number.NaN,
    expected.x,
    DIRECTION_TOLERANCE,
    "heading.x",
  );
  assertWithin(
    heading?.y ?? Number.NaN,
    expected.y,
    DIRECTION_TOLERANCE,
    "heading.y",
  );

  enable(h, "enemyMotion");
  const moved = await captureReplay(h, "headed", () => h.tick(1));
  const step = ENEMIES.gnat.speed * TICK_DT;
  const gnat = enemyById(moved, id);
  assertWithin(
    gnat?.x ?? Number.NaN,
    AT.x + expected.x * step,
    MOTION_TOLERANCE,
    "x after one tick",
  );
  assertWithin(
    gnat?.y ?? Number.NaN,
    AT.y + expected.y * step,
    MOTION_TOLERANCE,
    "y after one tick",
  );
});
