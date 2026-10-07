// Wick — enemies/weave-offset-formula: a weaver is drawn beside its anchor by
// the sine offset at its age.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Weave"): "the position
// is the anchor plus a perpendicular offset that swings with age:
// `offset(age) = WISP_AMPLITUDE * sin(2 * PI * age / WISP_PERIOD)`,
// `perp = (-hy, hx)`, `position = anchor + perp * offset(age)`", with
// `WISP_AMPLITUDE` (`40`) units and `WISP_PERIOD` (`1.0`) seconds; and one tick
// of a weaver is "`anchor = position - perp(heading) * offset(age)`;
// `heading = unit(lamplighter - anchor)`;
// `anchor = anchor + heading * speed * TICK_DT`; `age = age + TICK_DT`;
// `position = anchor + perp(heading) * offset(age)`". A wisp is "Wisp |
// `wisp` | 12 | 90 | 6 | 10 | medium | weave", so its step is `90 / 60` (`1.5`)
// units, and ("The life of an enemy") "every tick adds `TICK_DT` (`1 / 60`)" to
// `age`.
//
// THE POSE. An isolated night holding nothing but the lamplighter at the origin
// and one wisp, `enemyMotion` alone turned on, staged so that the tick's two
// halves land on separate axes and neither can stand in for the other. The wisp
// is spawned 300 units along `+x`, where its heading is `(-1, 0)` and, at `age`
// `0` with `offset(0)` `0`, its anchor is its spawn point. `setEnemyAge` then
// poses `age` `0.25`, where `offset` is the full `40`, and `setEnemyPosition`
// puts it at `(300, -40)`: with `perp((-1, 0))` `(0, -1)`, the anchor the state
// hides, "the position minus the offset at the current age", is back at
// `(300, 0)`. Both poses leave everything else alone
// (`specs/instrumentation.md`: `setEnemyPosition` leaves "its heading, age, and
// health ... untouched", and `setEnemyAge` sets the age alone).
//
// So the one tick that follows is fully determined: the anchor advances `1.5`
// along `(-1, 0)` to `(298.5, 0)`, the heading stays `(-1, 0)`, `age` becomes
// `0.25 + 1 / 60`, and the position is `(298.5, 0)` plus `(0, -1)` times
// `40 x sin(2 x PI x (0.25 + 1 / 60))`. The x of that position is the anchor's
// chase alone and the y is the offset alone, so a build with the wrong
// amplitude, the wrong period, the wrong perpendicular sign, or an offset read
// at the age before the tick is separated on the y by units.
//
// `enemyContact` is held, and the wisp stands 300 units out, so nothing else
// touches it.
//
// TOLERANCE. `POSITION_TOL` on both components: each is a figure the
// specification fixes exactly, reached through one `sin` and one product with
// `TICK_DT` (`1/60`, inexact in binary). The nearest wrong answers — the offset
// of the age before the tick (`40`), a `WISP_PERIOD` of `2` (`20.5`), the
// opposite perpendicular (`+39.78`) — are units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  POSITION_TOL,
  TICK_DT,
  WISP_AMPLITUDE,
  wispOffset,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";
import { headingOf } from "./stage";

/** How far along `+x` the wisp spawns: its heading is then `(-1, 0)`. */
const SPAWN_X = 300;

/** The age posed before the tick, where `offset` is the full `WISP_AMPLITUDE`. */
const POSED_AGE = 0.25;

/** A wisp's step: `90 / 60` units. */
const STEP = ENEMIES.wisp.speed * TICK_DT;

/** The age the tick leaves. */
const AGED = POSED_AGE + TICK_DT;

/** Where the anchor stands after the tick: `300 - 1.5` along `+x`. */
const ANCHOR_X = SPAWN_X - STEP;

/** The offset the tick's age gives, thrown along `perp((-1, 0))` = `(0, -1)`. */
const OFFSET_Y = -wispOffset(AGED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a wisp 40 x sin(2 PI x (0.25 + 1/60)) off its anchor along (-hy, hx)", async () => {
  await isolate(h, { on: ["enemyMotion"] });
  const wisp = await placeEnemy(h, "wisp", SPAWN_X, 0);
  await h.debug.setEnemyAge(wisp.id, POSED_AGE);
  await h.debug.setEnemyPosition(wisp.id, SPAWN_X, -WISP_AMPLITUDE);

  const after = await h.step(1);
  await captureStill(h, "weave");

  const woven = mustEnemy(after, wisp.id);
  assertNear(
    headingOf(woven).x,
    -1,
    FLOAT_TOL,
    "the wisp's heading x after the tick, toward the lamplighter from its anchor",
  );
  assertNear(
    headingOf(woven).y,
    0,
    FLOAT_TOL,
    "the wisp's heading y after the tick, toward the lamplighter from its anchor",
  );
  assertNear(
    woven.x,
    ANCHOR_X,
    POSITION_TOL,
    "the wisp's x after the tick: its anchor, which the offset does not reach",
  );
  assertNear(
    woven.y,
    OFFSET_Y,
    POSITION_TOL,
    "the wisp's y after the tick: the offset at 0.25 + 1/60, along (0, -1)",
  );
});
