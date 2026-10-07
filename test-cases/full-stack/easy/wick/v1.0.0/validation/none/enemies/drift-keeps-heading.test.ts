// Wick — enemies/drift-keeps-heading: a drifter holds the heading it spawned
// with for its whole life and flies straight on past the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Drift"): "A drifting
// enemy keeps the heading it spawned with for its whole life and advances one
// step along it every tick. Its heading is fixed at spawn: the unit vector from
// its spawn position to the lamplighter's center ... The lamplighter's later
// movement changes nothing about it, so a drifter that misses flies on until it
// despawns." A gnat is "Gnat | `gnat` | 2 | 160 | 3 | 8 | small | drift", so
// its step is `160 / 60` (`2.667`) units, and ("Movement") "one tick's step is
// `speed * TICK_DT` units".
//
// THE POSE. An isolated night holding nothing but the lamplighter and one gnat,
// `enemyMotion` alone turned on, the gnat spawned 300 units along `-y` with the
// lamplighter at the origin, so its spawn heading is `(0, 1)`; then the `right`
// action held through a real key for 120 ticks. The lamplighter leaves along
// `+x` at `180 / 60` (`3`) a tick while the gnat holds `(0, 1)`: a build that
// chased instead would swing the heading's x positive within a handful of
// ticks, and one that recomputed the drift heading each tick would do the same.
//
// Over the 120 ticks the gnat covers `120 x 160 / 60` = `320` units along `+y`
// from `-300`, so it crosses the lamplighter's own `y` and keeps going, which
// is the "flies on" half of the rule read off the last tick. `enemyContact` and
// `despawning` are held, so nothing removes it and nothing it touches reads
// into the positions.
//
// TOLERANCE. `FLOAT_TOL` on the heading, which is exactly the spawn's unit
// vector; `POSITION_TOL` on each tick's position, a reported point plus a speed
// times `TICK_DT` (`1/60`, inexact in binary). The nearest wrong answer, a
// heading recomputed toward a lamplighter now 360 units away, is a whole unit
// of position per tick away.

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
  player,
  type Harness,
} from "../harness";
import { headingOf } from "./stage";

/** The key that walks the lamplighter right: the first binding of `right`. */
const RIGHT_KEY = BINDINGS.right[0]!;

/** How far above the lamplighter the gnat starts, so its heading is `(0, 1)`. */
const START_ABOVE = 300;

/** The ticks the walk runs for: `320` units of drift, past the lamplighter. */
const TICKS = 120;

/** A gnat's step: `160 / 60` units. */
const STEP = ENEMIES.gnat.speed * TICK_DT;

/** The heading the spawn 300 units along `-y` gives it. */
const SPAWN_HEADING = { x: 0, y: 1 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a gnat's spawn heading across 120 ticks and steps 160 / 60 along it each tick", async () => {
  const posed = await isolate(h, { on: ["enemyMotion"] });
  const start = player(posed);
  const gnat = await placeEnemy(h, "gnat", start.x, start.y - START_ABOVE);
  assertNear(
    headingOf(gnat).x,
    SPAWN_HEADING.x,
    FLOAT_TOL,
    "the gnat's heading x at spawn, toward the lamplighter",
  );
  assertNear(
    headingOf(gnat).y,
    SPAWN_HEADING.y,
    FLOAT_TOL,
    "the gnat's heading y at spawn, toward the lamplighter",
  );

  const ticks = await captureReplay(h, "drift", () =>
    holdKeysWatching(h, [RIGHT_KEY], TICKS),
  );
  assertEqual(ticks.length, TICKS, "ticks stepped");

  let before = { x: gnat.x, y: gnat.y };
  for (const [index, tick] of ticks.entries()) {
    const drifting = mustEnemy(tick, gnat.id);
    assertNear(
      headingOf(drifting).x,
      SPAWN_HEADING.x,
      FLOAT_TOL,
      `tick ${index + 1}: the gnat's heading x, still the spawn's`,
    );
    assertNear(
      headingOf(drifting).y,
      SPAWN_HEADING.y,
      FLOAT_TOL,
      `tick ${index + 1}: the gnat's heading y, still the spawn's`,
    );
    assertNear(
      drifting.x,
      before.x + SPAWN_HEADING.x * STEP,
      POSITION_TOL,
      `tick ${index + 1}: the gnat's x, one step along the spawn heading`,
    );
    assertNear(
      drifting.y,
      before.y + SPAWN_HEADING.y * STEP,
      POSITION_TOL,
      `tick ${index + 1}: the gnat's y, one step along the spawn heading`,
    );
    before = { x: drifting.x, y: drifting.y };
  }

  // It flew past: 320 units of drift from 300 above leaves it below the y the
  // lamplighter walked along.
  const last = ticks[TICKS - 1]!;
  assertGreaterThan(
    mustEnemy(last, gnat.id).y,
    player(last).y,
    "the gnat's y after the drift, past the lamplighter's",
  );
});
