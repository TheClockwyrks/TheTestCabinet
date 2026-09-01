// Wick — instrumentation/set-enemy-age: `setEnemyAge(id, 0.25)` on a wisp reads
// back `age` 0.25, and on the next tick the wisp's offset follows from age
// `0.25 + TICK_DT`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setEnemyAge(id, seconds)`): "Sets enemy `id`'s `age` to `seconds`, at least
// `0`." specs/enemies.md — "Weave": one tick of a weaver is
//
//   anchor   = position - perp(heading) * offset(age)
//   heading  = unit(lamplighter - anchor)
//   anchor   = anchor + heading * speed * TICK_DT
//   age      = age + TICK_DT
//   position = anchor + perp(heading) * offset(age)
//
// with `offset(age) = WISP_AMPLITUDE * sin(2 * PI * age / WISP_PERIOD)` and
// `perp = (-hy, hx)`; "The state carries the position and the heading, and the
// anchor is the position minus the offset at the current age." The tick's
// arithmetic is restated below over the posed age and read to `POSITION_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. A quarter second is the age at which the
// offset is its full amplitude, so the anchor recovered from the posed age
// sits 40 units off the wisp, and a build that ignored the pose (offset `0` at
// a fresh spawn) recovers a different anchor and lands elsewhere.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, POSITION_TOL, TICK_DT, TIMER_TOL, wispOffset } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  unitToward,
  type EnemyView,
  type Harness,
  type XY,
} from "../harness";

const POSED_AGE = 0.25;

/** The heading rotated +90 degrees: `(-hy, hx)`. */
const perp = (heading: XY): XY => ({ x: -heading.y, y: heading.x });

/** Where one tick of the weave rule leaves a wisp that stands at `wisp`, chasing `player`. */
function weaveTick(wisp: EnemyView, player: XY): XY {
  const before = perp(wisp.heading);
  const offset = wispOffset(wisp.age);
  let anchor = { x: wisp.x - before.x * offset, y: wisp.y - before.y * offset };
  const heading = unitToward(anchor, player) ?? wisp.heading;
  const step = ENEMIES.wisp.speed * TICK_DT;
  anchor = { x: anchor.x + heading.x * step, y: anchor.y + heading.y * step };
  const after = perp(heading);
  const swung = wispOffset(wisp.age + TICK_DT);
  return { x: anchor.x + after.x * swung, y: anchor.y + after.y * swung };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses an enemy's age, and the weave follows from it", async () => {
  await isolate(h);
  const wisp = await placeEnemy(h, "wisp", 0, 300);
  assertEqual(wisp.age, 0, "the wisp's age at spawn");

  await h.debug.setEnemyAge(wisp.id, POSED_AGE);
  const aged = await h.snapshot();
  const posed = mustEnemy(aged, wisp.id);
  await captureStill(h, "aged");
  assertEqual(posed.age, POSED_AGE, "the wisp's age after the pose");

  await h.debug.setEnemyMotion(true);
  const ticked = await h.step(1);
  const moved = mustEnemy(ticked, wisp.id);
  const expected = weaveTick(posed, aged.run.player);
  assertNear(moved.age, POSED_AGE + TICK_DT, TIMER_TOL, "the wisp's age after the tick");
  assertNear(moved.x, expected.x, POSITION_TOL, "the wisp's x after one weave tick from the posed age");
  assertNear(moved.y, expected.y, POSITION_TOL, "the wisp's y after one weave tick from the posed age");
});
