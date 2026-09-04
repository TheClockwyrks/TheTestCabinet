// enemies/chase-heading-recomputed — a chaser re-aims at the lamplighter on
// every tick and advances one step along the heading it just took.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Chase"): "Each tick a
// chasing enemy recomputes its heading as the unit vector from its center to
// the lamplighter's center and advances one step along it. The heading is
// recomputed every tick, so a chaser turns with the lamplighter as it moves."
// One step is `speed * TICK_DT` ("Movement"), and a moth's speed is `100`
// ("Common enemies"), so a moth's tick is exactly
//
//   heading  = unit(player − position)
//   position = position + heading × 100 / 60
//
// with `position` the one the moth held before the tick and `player` the
// lamplighter's center on that tick. That is what this check reads, tick after
// tick: the expectation for each tick is computed from the state the previous
// tick left, so a moth that keeps an old heading, aims at anything but the
// lamplighter's center, or steps a distance of its own fails on the first tick
// it does.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one moth and
// nothing else, `enemyMotion` the one switch on. The moth is spawned `SPAWN`
// (400) units straight above the lamplighter, so its spawn heading is `(0, 1)`
// and every later turn is measured against a heading that started square to
// the walk. The lamplighter is then carried across the moth's path with
// `setPlayerPosition`, which "Sets the lamplighter's center; nothing else
// moves" (`specs/instrumentation.md`), from `WALK` units left of the origin to
// `WALK` units right of it, `STRIDE` units a tick. Posing the walk rather than
// holding a key keeps this check to the chase alone: whether a held key moves
// the lamplighter at all is `lamplighter/`'s point. `enemyContact` is off, so
// the moth passing near the lamplighter never lands a hit that could end the
// span, and the walk is short enough that the moth closes only `TICKS × 100 /
// 60` units of the 400 it started with, so the two centers never coincide and
// the holding rule of `chase-holds-at-center` never applies.
//
// WHY THE HEADINGS ARE REQUIRED TO SWING. A scenario in which the expected
// heading barely moved would pass a build that never re-aims, so the check
// refuses to grade one: the expected headings, each computed from the walk and
// the moth's own position, must span more than `MIN_SWING` degrees or the
// arrangement itself is at fault.
//
// THE TOLERANCE. `MOTION_EPS` on the heading's two components, each a unit
// vector, and on the position, one integration step of `100 / 60` units.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { ENEMIES, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  angleOf,
  angularOffset,
  captureReplay,
  createHarness,
  distance,
  enable,
  isolate,
  placeEnemyNear,
  unit,
  type Harness,
  type Point,
} from "../harness";
import { requireEnemy } from "./roster";

/** How far above the lamplighter the moth is spawned. */
const SPAWN = 400;

/** How far either side of the origin the lamplighter is carried. */
const WALK = 180;

/** Ticks of the walk: one tick a stride. */
const TICKS = 120;

/** The stride the lamplighter is carried each tick, in units. */
const STRIDE = (2 * WALK) / TICKS;

/** One tick of a moth's chase, in units. */
const STEP = ENEMIES.moth.speed * TICK_DT;

/** The degrees the expected headings must span for the walk to be a turn. */
const MIN_SWING = 45;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("re-aims a moth at the lamplighter's center every tick of a walk across its path", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", 0, -SPAWN);
  enable(h, "enemyMotion");

  /** The heading each tick was required to take, in degrees. */
  const wanted: number[] = [];

  await captureReplay(h, "chase", async () => {
    for (let tick = 1; tick <= TICKS; tick += 1) {
      const before = h.snapshot();
      const was = requireEnemy(before, moth);
      const player: Point = {
        x: -WALK + tick * STRIDE,
        y: before.run.player.y,
      };
      h.debug.setPlayerPosition(player.x, player.y);

      const heading = unit(player.x - was.x, player.y - was.y);
      const place: Point = {
        x: was.x + heading.x * STEP,
        y: was.y + heading.y * STEP,
      };
      wanted.push(angleOf(heading.x, heading.y));

      const now = requireEnemy(await advanceTicks(h, 1), moth);
      assertLessThanOrEqual(
        Math.hypot(now.heading.x - heading.x, now.heading.y - heading.y),
        MOTION_EPS,
        `tick ${tick}: how far the moth's heading lies from the unit vector to the lamplighter's center (specs/enemies.md, Chase)`,
      );
      assertLessThanOrEqual(
        distance(now, place),
        MOTION_EPS,
        `tick ${tick}: how far the moth lies from one ${STEP}-unit step along that heading (specs/enemies.md, Chase and Movement)`,
      );
    }
  });

  assertGreaterThan(
    Math.abs(angularOffset(wanted[0], wanted[wanted.length - 1])),
    MIN_SWING,
    "the degrees the required heading swung across the walk, which is what makes this a turn",
  );
});
