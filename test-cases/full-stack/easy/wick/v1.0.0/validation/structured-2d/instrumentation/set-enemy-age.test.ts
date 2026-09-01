// Wick — instrumentation/set-enemy-age: `setEnemyAge(id, 0.25)` on a wisp
// reads back age 0.25, and on the next tick the wisp's offset follows from
// age `0.25 + TICK_DT`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setEnemyAge(id, seconds)`: "Sets enemy `id`'s `age` to `seconds`".
// `specs/enemies.md`, "Weave", one tick of a weaver, in full:
//   anchor   = position − perp(heading) × offset(age)
//   heading  = unit(lamplighter − anchor)
//   anchor   = anchor + heading × speed × TICK_DT
//   age      = age + TICK_DT
//   position = anchor + perp(heading) × offset(age)
// with `offset(age) = WISP_AMPLITUDE × sin(2π × age / WISP_PERIOD)` and
// `perp = (−hy, hx)`. The expected position is that arithmetic over the state
// read after the pose. `MOTION_EPS` on the one integrated step.
//
// THE DRIVE. An isolated run, a wisp at (0, −300) (heading (0, 1) toward the
// origin), the pose read at the call, `enemyMotion` on, one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { ENEMIES, MOTION_EPS, TICK_DT, weaveOffset } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  unit,
  type Harness,
} from "../harness";

const POSED_AGE = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the age and the next weave step follows from it", async () => {
  isolate(h);
  const id = placeEnemy(h, "wisp", 0, -300);
  h.debug.setEnemyAge(id, POSED_AGE);
  const posed = enemyById(h.snapshot(), id);
  assertDefined(posed, "the wisp after the pose");
  if (posed === undefined) return;
  assertEqual(posed.age, POSED_AGE, "age after setEnemyAge(id, 0.25)");

  // The specification's tick, over the posed state, with the lamplighter at
  // the origin.
  const perp0 = { x: -posed.heading.y, y: posed.heading.x };
  const anchor0 = {
    x: posed.x - perp0.x * weaveOffset(posed.age),
    y: posed.y - perp0.y * weaveOffset(posed.age),
  };
  const heading = unit(-anchor0.x, -anchor0.y);
  const step = ENEMIES.wisp.speed * TICK_DT;
  const anchor1 = {
    x: anchor0.x + heading.x * step,
    y: anchor0.y + heading.y * step,
  };
  const age1 = posed.age + TICK_DT;
  const perp1 = { x: -heading.y, y: heading.x };
  const expected = {
    x: anchor1.x + perp1.x * weaveOffset(age1),
    y: anchor1.y + perp1.y * weaveOffset(age1),
  };

  enable(h, "enemyMotion");
  const moved = enemyById(await advanceTicks(h, 1), id);
  captureStill(h, "aged");
  assertDefined(moved, "the wisp after one tick");
  assertNear(moved?.age ?? Number.NaN, age1, MOTION_EPS, "age after one tick");
  assertNear(
    moved?.x ?? Number.NaN,
    expected.x,
    MOTION_EPS,
    "x after one weaving tick from age 0.25",
  );
  assertNear(
    moved?.y ?? Number.NaN,
    expected.y,
    MOTION_EPS,
    "y after one weaving tick from age 0.25",
  );
});
