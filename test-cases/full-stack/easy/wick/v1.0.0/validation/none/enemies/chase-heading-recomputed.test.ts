// Wick — enemies/chase-heading-recomputed: a chaser re-aims at the lamplighter
// on every tick and advances one step along the heading it just computed.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Chase"): "Each tick a
// chasing enemy recomputes its heading as the unit vector from its center to
// the lamplighter's center and advances one step along it. The heading is
// recomputed every tick, so a chaser turns with the lamplighter as it moves",
// and ("Movement") "one tick's step is `speed * TICK_DT` units". A moth is
// "Moth | `moth` | 5 | 100 | 5 | 10 | small | chase", so its step is `100 / 60`
// units. `specs/world.md` ("One tick") fixes which lamplighter the heading
// reads: phase 2 moves the lamplighter and phase 4 moves the enemies, "each
// reading the state the phases before it left", so the heading of a tick is the
// unit vector from the enemy's position of the tick BEFORE to the
// lamplighter's position of THIS tick, and the enemy's new position is that
// heading times the step added to where it stood.
//
// THE POSE. An isolated night holding nothing but the lamplighter and one moth,
// `enemyMotion` alone turned on, the moth spawned 300 units along `-y` so it
// starts directly above the lamplighter, and the `right` action held through a
// real key for 120 ticks. The lamplighter walks `MOVE_SPEED / 60` (`3`) units a
// tick and the moth closes at `100 / 60` (`1.667`), so the lamplighter walks
// out from under the moth and the moth's heading swings from straight down
// toward `+x` across the two seconds: a build that fixed the heading at spawn
// is separated within a handful of ticks. `enemyContact` is held, so nothing
// the two do to each other reads into the positions.
//
// Every tick's expectation is computed from the positions the PREVIOUS tick
// reported, so nothing accumulates and a build's own arithmetic is compared
// against the specification's once per tick.
//
// TOLERANCE. `FLOAT_TOL` on the heading, a unit vector of a difference of two
// reported positions; `POSITION_TOL` on the position, a reported point plus a
// speed times `TICK_DT` (`1/60`, inexact in binary). The wrong answers this
// separates — a heading frozen at spawn, a heading read from the lamplighter's
// position before it moved — are whole units of position away within the
// span.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import {
  BINDINGS,
  ENEMIES,
  FLOAT_TOL,
  POSITION_TOL,
  TICK_DT,
} from "../constants";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  isolate,
  mustEnemy,
  placeEnemy,
  unitToward,
  type Harness,
  type XY,
} from "../harness";
import { headingOf } from "./stage";

/** The key that walks the lamplighter right: the first binding of `right`. */
const RIGHT_KEY = BINDINGS.right[0]!;

/** How far above the lamplighter the moth starts. */
const START_ABOVE = 300;

/** The ticks the walk runs for: two seconds of turning. */
const TICKS = 120;

/** A moth's step: `100 / 60` units. */
const STEP = ENEMIES.moth.speed * TICK_DT;

/**
 * How far the heading's x must have swung by the end of the walk: the
 * trajectory the specification fixes reaches `0.87`, and a heading frozen at
 * spawn stands at `0`.
 */
const TURNED = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-aims a moth at the lamplighter's position of each tick and steps 100 / 60 along it", async () => {
  await isolate(h, { on: ["enemyMotion"] });
  const posed = await placeEnemy(h, "moth", 0, -START_ABOVE);

  const ticks = await captureReplay(h, "chase", () =>
    holdKeysWatching(h, [RIGHT_KEY], TICKS),
  );
  assertEqual(ticks.length, TICKS, "ticks stepped");

  let before: XY = { x: posed.x, y: posed.y };
  for (const [index, tick] of ticks.entries()) {
    const moth = mustEnemy(tick, posed.id);
    const wanted = unitToward(before, tick.run.player);
    assertNear(
      headingOf(moth).x,
      wanted?.x ?? Number.NaN,
      FLOAT_TOL,
      `tick ${index + 1}: the moth's heading x, toward the lamplighter of this tick`,
    );
    assertNear(
      headingOf(moth).y,
      wanted?.y ?? Number.NaN,
      FLOAT_TOL,
      `tick ${index + 1}: the moth's heading y, toward the lamplighter of this tick`,
    );
    assertNear(
      moth.x,
      before.x + (wanted?.x ?? Number.NaN) * STEP,
      POSITION_TOL,
      `tick ${index + 1}: the moth's x, one step along that heading`,
    );
    assertNear(
      moth.y,
      before.y + (wanted?.y ?? Number.NaN) * STEP,
      POSITION_TOL,
      `tick ${index + 1}: the moth's y, one step along that heading`,
    );
    before = { x: moth.x, y: moth.y };
  }

  // The walk turned the heading, so the span the check ran over is one a
  // frozen heading could not have survived. The specification fixes the swing:
  // the lamplighter walks `180 / 60` a tick and the moth follows at `100 / 60`
  // from 300 units above, which leaves the heading's x at `0.87` after 120
  // ticks against the `0.01` of the first. `TURNED` is well inside that.
  const last = mustEnemy(ticks[TICKS - 1]!, posed.id);
  assertGreaterThan(
    headingOf(last).x,
    TURNED,
    "the moth's heading x after the walk, swung toward the lamplighter's new side",
  );
});
