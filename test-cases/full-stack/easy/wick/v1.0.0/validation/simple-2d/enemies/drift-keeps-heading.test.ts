// Wick — enemies/drift-keeps-heading: a drifter keeps the heading it spawned
// with for its whole life and flies on past the lamplighter.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Drift"): "A drifting enemy keeps the heading it
//     spawned with for its whole life and advances one step along it every
//     tick. Its heading is fixed at spawn: the unit vector from its spawn
//     position to the lamplighter's center ... The lamplighter's later movement
//     changes nothing about it, so a drifter that misses flies on until it
//     despawns".
//   - `specs/enemies.md` ("The roster"): a gnat's behavior is `drift` and its
//     speed is `160`, so one step is 160 / 60 units ("Movement").
//   - `specs/instrumentation.md` (`setPlayerPosition`): "Sets the lamplighter's
//     center to `(x, y)`. Nothing else moves".
//
// WHAT IS READ. A gnat spawned 200 units along -x of the lamplighter, so its
// spawn heading is `(1, 0)`, then 120 ticks with the lamplighter posed around
// it in a full circle. On every one of those ticks the gnat's heading is the
// component-for-component `(1, 0)` it spawned with, and its center is the center
// it held before the tick plus that heading times the step. After 120 ticks it
// stands 320 units along its heading from its spawn point, which is 120 units
// PAST the lamplighter's starting center: it flew on rather than turning. A
// build that re-aims a drifter answers differently from the first tick the
// lamplighter is posed off the gnat's line.
//
// WHY THE NIGHT IS POSED AS IT IS. One gnat and nothing else, `enemyMotion` the
// only switch on: the only thing that moves the gnat is its own behavior.
// `despawning` is off, so the reading is of the drift and not of the removal
// rule, which the gnat stays well inside anyway; `enemyContact` is off, so the
// gnat crossing the lamplighter lands no hit. The lamplighter is posed on a
// circle of 120 units about the origin, which carries it to both sides of the
// gnat's line and in front of it and behind it.
//
// TOLERANCE. `DIRECTION_TOLERANCE` (1e-9) on each component of the kept
// heading; `MOTION_TOLERANCE` (1e-6) on each component of the position, which
// is integrated tick by tick and read after 120 of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
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
  pointAt,
  present,
  spawnEnemyNear,
  type EnemySnapshot,
  type Harness,
} from "../harness";

/** The drifter this point reads: a gnat, behavior `drift`, speed 160. */
const TYPE = "gnat";

/** One step of the gnat's speed: 160 / 60 units. */
const STEP = ENEMIES[TYPE].speed * TICK_DT;

/** Where the gnat is posed: along -x, so its spawn heading is `(1, 0)`. */
const GNAT_DX = -200;

/** The heading the spawn point gives it: toward the lamplighter's center. */
const HEADING = { x: 1, y: 0 };

/** How far from the origin the lamplighter is posed as it circles. */
const WALK_RADIUS = 120;

/** How many ticks the drift is read across. */
const TICKS = 120;

/** The degrees the lamplighter's circle turns each tick: a full turn. */
const WALK_DEGREES = 360 / TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the gnat's spawn heading for 120 ticks while the lamplighter walks around it", async () => {
  isolate(h);
  enable(h, "enemyMotion");
  const gnat = spawnEnemyNear(h, TYPE, GNAT_DX, 0);
  const spawned = present(enemyById(h.snapshot(), gnat), "the posed gnat");
  const samples: EnemySnapshot[] = [];

  await captureReplay(h, "drift", async () => {
    for (let i = 0; i < TICKS; i += 1) {
      const walk = pointAt({ x: 0, y: 0 }, WALK_RADIUS, i * WALK_DEGREES);
      h.debug.setPlayerPosition(walk.x, walk.y);
      const after = await h.tick(1);
      samples.push(
        present(enemyById(after, gnat), `the gnat on tick ${i + 1}`),
      );
    }
  });

  let was = spawned;
  for (const [i, now] of samples.entries()) {
    assertWithin(
      now.heading.x,
      HEADING.x,
      DIRECTION_TOLERANCE,
      `tick ${i + 1}: x of the heading the gnat spawned with`,
    );
    assertWithin(
      now.heading.y,
      HEADING.y,
      DIRECTION_TOLERANCE,
      `tick ${i + 1}: y of the heading the gnat spawned with`,
    );
    assertWithin(
      now.x,
      was.x + HEADING.x * STEP,
      MOTION_TOLERANCE,
      `tick ${i + 1}: x after one step along that heading`,
    );
    assertWithin(
      now.y,
      was.y + HEADING.y * STEP,
      MOTION_TOLERANCE,
      `tick ${i + 1}: y after one step along that heading`,
    );
    was = now;
  }

  const last = samples[samples.length - 1];
  assertWithin(
    last.x,
    spawned.x + TICKS * STEP,
    MOTION_TOLERANCE,
    "the gnat's x after 120 steps",
  );
  assertGreaterThan(last.x, 0, "how far past the origin the gnat flew");
});
