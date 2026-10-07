// enemies/weave-offset-formula — a weaver is drawn beside its anchor by the
// sine offset its age carries.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Weave") states the
// offset and where it is laid:
//
//   offset(age) = WISP_AMPLITUDE * sin(2 * PI * age / WISP_PERIOD)
//   perp        = (-hy, hx)
//   position    = anchor + perp * offset(age)
//
// with `WISP_AMPLITUDE` (`40`) units and `WISP_PERIOD` (`1.0`) seconds, and
// the tick's own order puts the age's rise before the position is rebuilt:
// "age = age + TICK_DT" then "position = anchor + perp(heading) * offset(age)".
// So a wisp whose age reads `AGE` (0.25) before a tick is, after it, offset
// from its anchor by `40 × sin(2π × (0.25 + 1/60))`, which is `39.780...`
// units, laid along `(-hy, hx)` of the heading the tick left. That figure and
// that direction are what this check reads.
//
// HOW THE OFFSET IS READ WITHOUT THE ANCHOR. The anchor is not a snapshot
// field: "The state carries the position and the heading, and the anchor is
// the position minus the offset at the current age." So the anchor this tick
// started from is recovered from the state before the tick, and the offset is
// read as the component of the whole tick's displacement that lies ALONG the
// perpendicular. The tick's other term, "anchor = anchor + heading * speed *
// TICK_DT", lies along the heading, and the heading is square to its own
// perpendicular, so that term contributes exactly nothing to the component
// read here: what the reading isolates is the offset alone, and how far the
// anchor advanced is `weave-anchor-chases`'s point.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one wisp, with
// `enemyMotion` the one switch on, so the single tick that runs is a tick of
// the weave and nothing else. The wisp is spawned `SPAWN` (500) units straight
// above the lamplighter, where its offset is `0` and its anchor is its spawn
// point ("At spawn the offset is `0`, so the anchor is the spawn position"),
// and its age is then posed to `AGE` with `setEnemyAge`, which sets the age and
// nothing else (`specs/instrumentation.md`). 500 units keeps the anchor far
// from the lamplighter, so the tick is an ordinary one rather than the held
// tick of `weave-holds-at-center`. `enemyContact` is off and nothing else is
// alive.
//
// THE TOLERANCE. `MOTION_EPS`, the bound for a figure reached by an
// integration step: the reading is a product of a table amplitude and a sine,
// projected onto a unit vector.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS, TICK_DT, weaveOffset } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { requireEnemy, stepPointOf } from "./roster";

/** How far above the lamplighter the wisp is spawned. */
const SPAWN = 500;

/** The age the wisp is posed to before the tick, in seconds. */
const AGE = 0.25;

/** The offset the tick's own age carries: `40 × sin(2π × (0.25 + 1/60))`. */
const EXPECTED = weaveOffset(AGE + TICK_DT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stands a wisp 39.78 units along the perpendicular of its heading after a tick at age 0.25", async () => {
  isolate(h);
  const wisp = placeEnemyNear(h, "wisp", 0, -SPAWN);
  h.debug.setEnemyAge(wisp, AGE);
  enable(h, "enemyMotion");
  const before = requireEnemy(h.snapshot(), wisp);
  const anchor = stepPointOf(before);

  const after = requireEnemy(await advanceTicks(h, 1), wisp);
  captureStill(h, "weave");

  // The perpendicular of the heading the tick left, `(-hy, hx)`.
  const perp = { x: -after.heading.y, y: after.heading.x };
  const offset = (after.x - anchor.x) * perp.x + (after.y - anchor.y) * perp.y;

  assertNear(
    offset,
    EXPECTED,
    MOTION_EPS,
    "how far along the perpendicular of its heading the wisp stands from its anchor (specs/enemies.md, Weave)",
  );
});
