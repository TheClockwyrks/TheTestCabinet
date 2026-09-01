// director/dark-pursues — the Dark chases the lamplighter, one step of
// `speed × TICK_DT` along a heading it recomputes every tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Elites and the Dark"): the Dark's speed is 170 and
//     its behavior is `chase`.
//   - `specs/enemies.md` ("Chase"): "Each tick a chasing enemy recomputes its
//     heading as the unit vector from its center to the lamplighter's center
//     and advances one step along it. The heading is recomputed every tick, so
//     a chaser turns with the lamplighter as it moves."
//   - `specs/enemies.md` ("Movement"): "Every rate below is per second,
//     integrated on the fixed tick, so one tick's step is `speed * TICK_DT`
//     units."
//   - `specs/world.md` ("One tick"), phase 4: "Every enemy ages by `TICK_DT`,
//     and, while `enemyMotion` is on, moves as `specs/enemies.md` states."
//
// WHAT IS READ. The Dark is placed 500 units to the lamplighter's right and one
// tick is run: its step must be 170 / 60 units along the unit vector toward the
// lamplighter's center. The lamplighter is then posed away, at a right angle to
// where the Dark now stands, and another tick is run: the second step must lie
// along the NEW unit vector, which is what "recomputed every tick" means. A
// build that fixed the heading at spawn takes the second step along the first
// direction and misses by most of the step.
//
// WHY THE NIGHT IS POSED AS IT IS. `enemyMotion` alone is on: nothing else is
// on the field, no weapon fires at the Dark, and contact is held, so the two
// steps read are the Dark's own motion and nothing else. The lamplighter is
// moved by the surface rather than by keys, so its position between the two
// ticks is exact.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on each coordinate: a position
// integrated one tick at a time from stated figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { ENEMIES, MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  enemyById,
  isolate,
  present,
  spawnEnemyAt,
  type Harness,
  unit,
} from "../harness";

/** One tick of the Dark's travel: "speed * TICK_DT", 170 / 60 units. */
const STEP = ENEMIES.dark.speed * TICK_DT;

/** Where the Dark starts: 500 units to the lamplighter's right. */
const START_X = 500;
const START_Y = 0;

/** Where the lamplighter moves for the second step: 500 units below the origin. */
const MOVED_X = 0;
const MOVED_Y = 500;

/** Ticks of pursuit recorded after the readings, for the evidence. */
const PURSUIT_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances the Dark one step along the vector toward the lamplighter", async () => {
  isolate(h);
  enable(h, "enemyMotion");
  const dark = spawnEnemyAt(h, "dark", START_X, START_Y);
  const opening = h.snapshot();

  const read = await captureReplay(h, "pursuit", async () => {
    const first = await h.tick(1);
    h.debug.setPlayerPosition(MOVED_X, MOVED_Y);
    const second = await h.tick(1);
    await h.tick(PURSUIT_TICKS);
    return { first, second };
  });

  const before = present(enemyById(opening, dark), "the Dark as posed");
  const stepped = present(enemyById(read.first, dark), "the Dark after a tick");
  const toward = unit(
    read.first.run.player.x - before.x,
    read.first.run.player.y - before.y,
  );
  assertWithin(
    stepped.x,
    before.x + toward.x * STEP,
    MOTION_TOLERANCE,
    "the Dark's x after one tick of pursuit",
  );
  assertWithin(
    stepped.y,
    before.y + toward.y * STEP,
    MOTION_TOLERANCE,
    "the Dark's y after one tick of pursuit",
  );

  const turned = present(
    enemyById(read.second, dark),
    "the Dark after the lamplighter moved",
  );
  const recomputed = unit(MOVED_X - stepped.x, MOVED_Y - stepped.y);
  assertWithin(
    turned.x,
    stepped.x + recomputed.x * STEP,
    MOTION_TOLERANCE,
    "the Dark's x after a step along the recomputed heading",
  );
  assertWithin(
    turned.y,
    stepped.y + recomputed.y * STEP,
    MOTION_TOLERANCE,
    "the Dark's y after a step along the recomputed heading",
  );
});
