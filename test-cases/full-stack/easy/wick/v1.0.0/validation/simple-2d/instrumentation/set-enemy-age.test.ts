// instrumentation/set-enemy-age — `setEnemyAge(id, 0.25)` on a wisp reads
// back age 0.25, and on the next tick the wisp's offset follows from age
// 0.25 + TICK_DT.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setEnemyAge`:
// "Sets enemy `id`'s `age` to `seconds`, at least `0`". specs/enemies.md,
// "Weave", one tick of a weaver, with WISP_AMPLITUDE 40, WISP_PERIOD 1.0, and
// the wisp's speed 90:
//   anchor   = position − perp(heading) × offset(age)
//   heading  = unit(lamplighter − anchor)
//   anchor   = anchor + heading × speed × TICK_DT
//   age      = age + TICK_DT
//   position = anchor + perp(heading) × offset(age)
// with offset(age) = WISP_AMPLITUDE × sin(2π × age / WISP_PERIOD) and
// perp(h) = (−hy, hx). specs/state.md: for a weaver "the anchor is derived
// by subtracting the offset that `heading` and `age` give".
//
// THE POSE. An isolated run, a wisp at (0, 200) with the lamplighter at the
// origin, the pose read back, `enemyMotion` on, and one tick: the wisp's
// position is the tick above computed from the posed age, at
// MOTION_TOLERANCE.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin } from "../assert";
import { ENEMIES, MOTION_TOLERANCE, TICK_DT, weaveOffset } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyAt,
  unit,
  type Harness,
  type Point,
} from "../harness";

const AT = { x: 0, y: 200 };
const POSED_AGE = 0.25;

/** `(−hy, hx)`: the heading rotated +90 degrees. */
function perp(heading: Point): Point {
  return { x: -heading.y, y: heading.x };
}

/** One weave tick from the spec, over a position, heading, and age. */
function weaveTick(
  position: Point,
  heading: Point,
  age: number,
  lamplighter: Point,
): Point {
  const p = perp(heading);
  const off = weaveOffset(age);
  let anchor = { x: position.x - p.x * off, y: position.y - p.y * off };
  const next = unit(lamplighter.x - anchor.x, lamplighter.y - anchor.y);
  const step = ENEMIES.wisp.speed * TICK_DT;
  anchor = { x: anchor.x + next.x * step, y: anchor.y + next.y * step };
  const p2 = perp(next);
  const off2 = weaveOffset(age + TICK_DT);
  return { x: anchor.x + p2.x * off2, y: anchor.y + p2.y * off2 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the age and the next weave step reads it", async () => {
  isolate(h);
  const lamplighter = h.snapshot().run.player;
  const id = spawnEnemyAt(h, "wisp", AT.x, AT.y);

  h.debug.setEnemyAge(id, POSED_AGE);
  const posed = enemyById(h.snapshot(), id);
  assertDefined(posed, "the wisp after the pose");
  assertEqual(posed?.age, POSED_AGE, "age read back");

  enable(h, "enemyMotion");
  const moved = await h.tick(1);
  captureStill(h, "aged");
  const wisp = enemyById(moved, id);
  const expected = weaveTick(
    { x: posed?.x ?? 0, y: posed?.y ?? 0 },
    posed?.heading ?? { x: 0, y: 0 },
    POSED_AGE,
    { x: lamplighter.x, y: lamplighter.y },
  );
  assertWithin(
    wisp?.age ?? Number.NaN,
    POSED_AGE + TICK_DT,
    MOTION_TOLERANCE,
    "age after the tick",
  );
  assertWithin(
    wisp?.x ?? Number.NaN,
    expected.x,
    MOTION_TOLERANCE,
    "x after the weave step",
  );
  assertWithin(
    wisp?.y ?? Number.NaN,
    expected.y,
    MOTION_TOLERANCE,
    "y after the weave step",
  );
});
