// enemies/drift-keeps-heading — a drifter keeps its spawn heading for its whole
// life and flies on past the lamplighter.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Drift"): "A drifting
// enemy keeps the heading it spawned with for its whole life and advances one
// step along it every tick. Its heading is fixed at spawn: the unit vector from
// its spawn position to the lamplighter's center ... The lamplighter's later
// movement changes nothing about it, so a drifter that misses flies on until it
// despawns." A gnat is the one drifting row ("Common enemies"), its speed
// `160`, so one step is `160 / 60` units ("Movement"). A gnat spawned `SPAWN`
// (300) units straight above the lamplighter therefore takes heading `(0, 1)`
// and holds it, and after `TICKS` (120) ticks it stands exactly
//
//   spawn + (0, 1) × 120 × 160 / 60
//
// which is `320` units down the axis, `20` units PAST the origin the
// lamplighter started at: the "flies on past the lamplighter" of the rule, read
// as a number rather than an impression.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one gnat and
// nothing else, `enemyMotion` the one switch on. The lamplighter is carried
// around the gnat with `setPlayerPosition`, which "Sets the lamplighter's
// center; nothing else moves" (`specs/instrumentation.md`), once a tick around
// a circle of `ORBIT` (240) units about the origin, so a build that re-aimed a
// drifter at the lamplighter would be aiming somewhere new on every tick of
// the span and cannot pass by standing still. `enemyContact` is off, so the
// gnat crossing the lamplighter lands no hit, and `despawning` is off, so
// nothing removes it while the walk carries the lamplighter about; both are
// other points' business.
//
// WHAT IS READ. Every tick: that the heading still reads the spawn heading, and
// that the gnat advanced exactly one step along it. The final position closes
// the check against the figure above.
//
// THE TOLERANCE. `MOTION_EPS` on the heading and on each step, and on the
// finish, which is 120 integration steps: the bound is stated for a span of
// 36000, so it covers this one many times over.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { ENEMIES, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  distance,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
  type Point,
} from "../harness";
import { requireEnemy } from "./roster";

/** How far above the lamplighter the gnat is spawned. */
const SPAWN = 300;

/** The radius of the circle the lamplighter is carried around. */
const ORBIT = 240;

/** Ticks of the drift. */
const TICKS = 120;

/** One tick of a gnat's drift, in units. */
const STEP = ENEMIES.gnat.speed * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds a gnat's spawn heading for 120 ticks and carries it 320 units past the lamplighter", async () => {
  isolate(h);
  const origin = h.snapshot().run.player;
  const gnat = placeEnemyNear(h, "gnat", 0, -SPAWN);
  enable(h, "enemyMotion");
  const spawned = requireEnemy(h.snapshot(), gnat);

  await captureReplay(h, "drift", async () => {
    for (let tick = 1; tick <= TICKS; tick += 1) {
      const was = requireEnemy(h.snapshot(), gnat);
      const angle = (2 * Math.PI * tick) / TICKS;
      h.debug.setPlayerPosition(
        origin.x + Math.cos(angle) * ORBIT,
        origin.y + Math.sin(angle) * ORBIT,
      );

      const now = requireEnemy(await advanceTicks(h, 1), gnat);
      assertLessThanOrEqual(
        Math.hypot(
          now.heading.x - spawned.heading.x,
          now.heading.y - spawned.heading.y,
        ),
        MOTION_EPS,
        `tick ${tick}: how far the gnat's heading lies from the one it spawned with (specs/enemies.md, Drift)`,
      );
      assertLessThanOrEqual(
        distance(now, {
          x: was.x + spawned.heading.x * STEP,
          y: was.y + spawned.heading.y * STEP,
        }),
        MOTION_EPS,
        `tick ${tick}: how far the gnat lies from one ${STEP}-unit step along that heading (specs/enemies.md, Drift and Movement)`,
      );
    }
  });

  const flown: Point = {
    x: spawned.x + spawned.heading.x * STEP * TICKS,
    y: spawned.y + spawned.heading.y * STEP * TICKS,
  };
  assertLessThanOrEqual(
    distance(requireEnemy(h.snapshot(), gnat), flown),
    MOTION_EPS,
    "how far the gnat lies from its spawn point plus 120 steps of its spawn heading (specs/enemies.md, Drift)",
  );
});
