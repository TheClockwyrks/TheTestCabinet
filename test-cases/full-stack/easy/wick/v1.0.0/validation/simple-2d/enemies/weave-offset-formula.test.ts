// Wick — enemies/weave-offset-formula: a weaver is drawn beside its anchor by
// the sine offset, along the perpendicular of its heading.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Weave"): "the position is the anchor plus a
//     perpendicular offset that swings with age", with
//     `offset(age) = WISP_AMPLITUDE * sin(2 * PI * age / WISP_PERIOD)`,
//     `perp = (-hy, hx)` "the heading `(hx, hy)` rotated +90 degrees", and
//     `position = anchor + perp * offset(age)`; `WISP_AMPLITUDE` is `40` and
//     `WISP_PERIOD` is `1.0`.
//   - `specs/enemies.md` ("Weave"), one tick of a weaver, in this order:
//     `anchor = position - perp(heading) * offset(age)`, then
//     `heading = unit(lamplighter - anchor)`, then
//     `anchor = anchor + heading * speed * TICK_DT`, then
//     `age = age + TICK_DT`, then `position = anchor + perp(heading) *
//     offset(age)`. A wisp's speed is `90` ("The roster"), so its step is 1.5
//     units.
//   - `specs/instrumentation.md` (`setEnemyAge`): "Sets enemy `id`'s `age` to
//     `seconds`, at least `0`"; (`spawnEnemy`): a spawn's `age` is `0`, so at
//     the pose the anchor is the spawn point and the heading points at the
//     lamplighter.
//
// WHAT IS READ. One tick of a wisp posed at age `0.25`. The anchor that tick
// works from, the heading it recomputes, and the anchor it advances to all
// follow from the figures above, and what this point reads is the LAST line:
// the wisp's center after the tick, minus that anchor, decomposed along the
// heading and along its perpendicular. The perpendicular component is
// `40 × sin(2π × (0.25 + TICK_DT))` and the component along the heading is `0`,
// so the wisp is offset from its anchor by exactly the swing the formula gives
// and in exactly the direction it gives. A build that offsets along the heading
// rather than across it, that reads the offset at the age before the tick, or
// that swings by a different amplitude or period answers differently.
//
// WHY THE NIGHT IS POSED AS IT IS. One wisp and nothing else, `enemyMotion` the
// only switch on, so the only thing that moves it is its own behavior. It is
// posed 300 units along +x of the lamplighter, far enough that a 1.5-unit step
// leaves the geometry well conditioned and the two never coincide. The age of
// `0.25` puts the swing at its crest, `sin(π/2)`, so the offset under test is
// the full amplitude rather than a value near zero that a build ignoring the
// offset entirely could pass.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on each component, which are positions
// the build integrates, and `DIRECTION_TOLERANCE` (1e-9) on the heading the
// decomposition is taken along.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import {
  DIRECTION_TOLERANCE,
  ENEMIES,
  MOTION_TOLERANCE,
  TICK_DT,
  weaveOffset,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  unit,
  type Harness,
  type Point,
} from "../harness";

/** The weaver this point reads: a wisp, behavior `weave`, speed 90. */
const TYPE = "wisp";

/** One step of the wisp's speed: 90 / 60 = 1.5 units. */
const STEP = ENEMIES[TYPE].speed * TICK_DT;

/** Where the wisp is posed, along +x of the lamplighter's center. */
const WISP_DX = 300;

/** The age it is posed at: the crest of the swing, `sin(π/2)`. */
const POSED_AGE = 0.25;

/** `(-hy, hx)`, the heading rotated +90 degrees. */
function perp(heading: Point): Point {
  return { x: -heading.y, y: heading.x };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("offsets the wisp from its anchor by the sine swing, across its heading", async () => {
  isolate(h);
  enable(h, "enemyMotion");
  const wisp = spawnEnemyNear(h, TYPE, WISP_DX, 0);
  h.debug.setEnemyAge(wisp, POSED_AGE);
  const posed = h.snapshot();
  const was = present(enemyById(posed, wisp), "the posed wisp");
  const player = { x: posed.run.player.x, y: posed.run.player.y };

  // The tick's first three lines, as specs/enemies.md gives them.
  const before = perp(was.heading);
  const offsetAtPose = weaveOffset(was.age);
  const anchor = {
    x: was.x - before.x * offsetAtPose,
    y: was.y - before.y * offsetAtPose,
  };
  const heading = unit(player.x - anchor.x, player.y - anchor.y);
  const advanced = {
    x: anchor.x + heading.x * STEP,
    y: anchor.y + heading.y * STEP,
  };
  const swing = weaveOffset(POSED_AGE + TICK_DT);

  const after = await h.tick(1);
  captureStill(h, "weave");

  const now = present(enemyById(after, wisp), "the wisp after the tick");
  assertWithin(
    now.heading.x,
    heading.x,
    DIRECTION_TOLERANCE,
    "x of the heading the tick recomputed",
  );
  assertWithin(
    now.heading.y,
    heading.y,
    DIRECTION_TOLERANCE,
    "y of the heading the tick recomputed",
  );
  const across = perp(heading);
  const delta = { x: now.x - advanced.x, y: now.y - advanced.y };
  assertWithin(
    delta.x * across.x + delta.y * across.y,
    swing,
    MOTION_TOLERANCE,
    "the offset from the anchor across the heading",
  );
  assertWithin(
    delta.x * heading.x + delta.y * heading.y,
    0,
    MOTION_TOLERANCE,
    "the offset from the anchor along the heading",
  );
});
