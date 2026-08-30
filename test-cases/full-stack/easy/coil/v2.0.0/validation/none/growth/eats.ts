// growth — driving a long run of real eats, and keeping every cell the game put a
// pellet on.
//
// WHY A SHARED DRIVE. Four points in this directory read the same run from
// different angles: every placed pellet is an interior cell, none of them lands on
// the snake, they are not all the same cell, and the sequence repeats from a seed.
// The valid set of specs/board.md is what they are all about, and the only honest
// way to see it is to make the game place a great many pellets and look at where
// they went. Each point asserts its own one thing over the run; the run itself is
// written once, here.
//
// HOW A RUN IS MADE TO LAST. Every tick eats, so the chain never retracts and the
// board fills steadily — which is the point, because a valid set that is easy to
// draw from at three cells long is the one a build gets right by accident. The
// path the head walks is the harness's boustrophedon over the interior, so the
// chain after `k` eats is exactly the first `start + k` cells of that walk, laid
// head-last. Consecutive cells are adjacent by construction, no cell repeats, and
// the cell each eat enters is free because the walk has not reached it yet.
//
// WHAT IS AND IS NOT ARRANGED. The meal is placed by hand each tick, through
// `setPellet`, which specs/instrumentation.md says "is not spawning one, so the
// generator is not drawn from and the seeded sequence is left where it stands".
// So the head is steered along a known path without touching the draw under test,
// and what is recorded is the pellet the game itself placed at step 5. The
// obstacle course is cleared first: the walk crosses the whole interior, and a
// course laid across it is furniture none of these points is about.

import { assertEqual, fail } from "../assert";
import { DIRECTIONS, type Cell, type Dir } from "../constants";
import {
  ahead,
  clearObstacles,
  sameCell,
  serpentine,
  type CoilSnapshot,
  type Harness,
} from "../harness";

/** What one eat left: the pellet the game placed, and the chain it placed it around. */
export interface Placement {
  /** The cell step 5 spawned the next pellet on. */
  pellet: Cell;
  /** The chain as it stood when that pellet was placed, head first. */
  snake: Cell[];
}

/** What a run of eats left behind. */
export interface EatRun {
  placements: Placement[];
  snapshot: CoilSnapshot;
}

/** How a run of eats is laid out. */
export interface EatOptions {
  /** Cells of the interior walk the chain starts as. At least 2. */
  start?: number;
  /** Eats driven, each one tick. */
  eats: number;
  /** The seed the pellet generator is laid with. */
  seed?: number;
}

/**
 * Pose a chain along the interior walk and drive `eats` real eats along it,
 * keeping the cell the game placed each replacement pellet on.
 */
export async function driveEats(
  h: Harness,
  options: EatOptions,
): Promise<EatRun> {
  const { debug } = h;
  const start = options.start ?? 3;
  const path = serpentine();

  await debug.reset(options.seed === undefined ? undefined : { seed: options.seed });
  await clearObstacles(h);
  await debug.setSnake(path.slice(0, start).reverse());
  await debug.clearTurns();
  await debug.setPelletRespawn(true);
  await debug.setScreen("playing");

  const placements: Placement[] = [];
  let snapshot = await h.snapshot();
  for (let eat = 0; eat < options.eats; eat += 1) {
    const head = snapshot.snake[0];
    const meal = path[start + eat];
    const facing: Dir =
      DIRECTIONS.find((dir) => sameCell(ahead(head, dir), meal)) ??
      fail("the next meal one step from the head", { head, meal });
    await debug.setDirection(facing);
    await debug.setPellet(meal.col, meal.row);
    snapshot = await h.tick();
    assertEqual(
      snapshot.pellet === null,
      false,
      `a replacement pellet after eat ${eat + 1}`,
    );
    placements.push({
      pellet: snapshot.pellet as Cell,
      snake: snapshot.snake,
    });
  }
  return { placements, snapshot };
}
