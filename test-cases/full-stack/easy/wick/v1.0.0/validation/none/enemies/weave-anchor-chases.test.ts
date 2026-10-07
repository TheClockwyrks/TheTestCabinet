// Wick — enemies/weave-anchor-chases: a weaver's anchor is what chases, one
// step a tick toward the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Weave"): "A weaving
// enemy chases with an anchor and is drawn beside it. The anchor is what
// advances toward the lamplighter", and one tick of a weaver is
// "`anchor = position - perp(heading) * offset(age)`;
// `heading = unit(lamplighter - anchor)`;
// `anchor = anchor + heading * speed * TICK_DT`". A wisp is "Wisp | `wisp` |
// 12 | 90 | 6 | 10 | medium | weave", so its step is `90 / 60` (`1.5`) units.
// `specs/world.md` ("One tick") fixes which lamplighter the heading reads:
// phase 2 moves the lamplighter and phase 4 moves the enemies, "each reading
// the state the phases before it left", so a tick's anchor advances toward the
// lamplighter's position of THAT tick from the anchor of the tick before.
//
// The anchor is not a reported field: "The state carries the position and the
// heading, and the anchor is the position minus the offset at the current age",
// so the check recovers it from the position, the heading, and the age the
// snapshot reports, exactly as that sentence defines it, with
// `offset(age) = WISP_AMPLITUDE * sin(2 * PI * age / WISP_PERIOD)`.
//
// THE POSE. An isolated night holding nothing but the lamplighter and one wisp,
// `enemyMotion` alone turned on, the wisp spawned 300 units along `-y` — where
// `age` is `0`, `offset(0)` is `0` and the anchor is the spawn point — and the
// `right` action held through a real key for 60 ticks. The lamplighter walks
// out from under it at `180 / 60` (`3`) a tick, so the direction the anchor
// must take turns every tick and a build that fixed it at spawn is separated
// within a handful of them. Each tick's expectation is computed from the anchor
// the PREVIOUS tick reported, so nothing accumulates.
//
// `enemyContact` is held, so nothing the two do to each other reads into the
// positions.
//
// TOLERANCE. `POSITION_TOL` on the recovered anchor: a reported position less a
// product of `40` and a `sin`, plus a speed times `TICK_DT` (`1/60`, inexact in
// binary). The nearest wrong answers — an anchor that advances by the wisp's
// drawn displacement rather than `1.5`, or one aimed where the lamplighter
// stood a tick earlier — are whole units away across the span.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BINDINGS, ENEMIES, POSITION_TOL, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  isolate,
  mustEnemy,
  placeEnemy,
  player,
  unitToward,
  type Harness,
  type XY,
} from "../harness";
import { trackOf } from "./stage";

/** The key that walks the lamplighter right: the first binding of `right`. */
const RIGHT_KEY = BINDINGS.right[0]!;

/** How far above the lamplighter the wisp starts. */
const START_ABOVE = 300;

/** The ticks the walk runs for. */
const TICKS = 60;

/** A wisp's step: `90 / 60` units. */
const STEP = ENEMIES.wisp.speed * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances a wisp's anchor 90 / 60 a tick along the unit vector toward the lamplighter", async () => {
  const posed = await isolate(h, { on: ["enemyMotion"] });
  const start = player(posed);
  const wisp = await placeEnemy(h, "wisp", start.x, start.y - START_ABOVE);

  const ticks = await captureReplay(h, "anchor", () =>
    holdKeysWatching(h, [RIGHT_KEY], TICKS),
  );
  assertEqual(ticks.length, TICKS, "ticks stepped");

  let anchor: XY = trackOf(wisp);
  for (const [index, tick] of ticks.entries()) {
    const wanted = unitToward(anchor, tick.run.player);
    const expected = {
      x: anchor.x + (wanted?.x ?? Number.NaN) * STEP,
      y: anchor.y + (wanted?.y ?? Number.NaN) * STEP,
    };
    anchor = trackOf(mustEnemy(tick, wisp.id));
    assertNear(
      anchor.x,
      expected.x,
      POSITION_TOL,
      `tick ${index + 1}: the wisp's anchor x, one step toward the lamplighter of this tick`,
    );
    assertNear(
      anchor.y,
      expected.y,
      POSITION_TOL,
      `tick ${index + 1}: the wisp's anchor y, one step toward the lamplighter of this tick`,
    );
  }
});
