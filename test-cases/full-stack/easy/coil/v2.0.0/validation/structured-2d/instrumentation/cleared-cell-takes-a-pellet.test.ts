// instrumentation/cleared-cell-takes-a-pellet — a cleared cell is open to a
// pellet again.
//
// specs/instrumentation.md says of the cells `clearObstacles` takes off that
// "they become ordinary interior cells: the head crosses them safely and a pellet
// may spawn on them". This point is the second half. The head crossing one is
// `instrumentation/cleared-cell-is-safe`, and the reported list emptying is
// `instrumentation/clear-obstacles-empties-the-list`.
//
// THE DRAW IS FORCED RATHER THAN SAMPLED. specs/board.md draws the next pellet
// "at a uniformly random cell" of the valid set, so watching a wide-open board
// and waiting for a pellet to land on one particular cell would be a lottery. The
// board is instead posed so that the valid set holds EXACTLY the cleared cell:
// the interior is walked in one contiguous path, the chain covers the path up to
// the cell before the target, obstacles are laid over the path after it, and the
// pellet the head is about to eat sits on the one cell between the two. When step
// 5 draws, there is one cell to draw from, and it is a cell the course was
// holding a moment earlier. A build that emptied its reported list without
// opening the cells finds no valid cell at all and ends the round instead.
//
// THE TARGET IS TAKEN OFF THE BUILD'S OWN COURSE rather than off
// `MAZE_OBSTACLES`, because whether the laid course is the right eighteen cells
// is `board/obstacles-layout`. The cell chosen is the one the walk reaches LAST,
// so the obstacles laid behind it are few.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  fail,
} from "../assert";
import { DIRECTIONS, type Cell, type Dir } from "../constants";
import {
  ahead,
  captureReplay,
  createHarness,
  holdsCell,
  poseScene,
  sameCell,
  serpentine,
  type Harness,
} from "../harness";

/** Ticks run after the draw, with the chain held, so the board is seen settled. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the next pellet onto a cell the course was holding", async () => {
  // The course as the build lays it, so the cell chosen is one it really held.
  const laid = poseScene(h, { obstacles: "course", pellet: null });
  assertGreaterThan(
    laid.obstacles.length,
    0,
    "obstacle cells on the board of a mode that lays a course",
  );

  // The interior as one contiguous walk, and the course cell it reaches last.
  const path = serpentine();
  let target = -1;
  for (const [index, cell] of path.entries()) {
    if (holdsCell(laid.obstacles, cell)) target = index;
  }
  if (target < 2 || target > path.length - 2) {
    return fail(
      "a course cell the interior walk reaches with room on both sides of it",
      laid.obstacles,
    );
  }
  const cleared: Cell = path[target];

  // The chain up to two cells short of the target, the meal on the cell between
  // them, and everything past the target laid solid.
  const chain = path.slice(0, target - 1).reverse();
  const meal: Cell = path[target - 1];
  const beyond = path.slice(target + 1);
  const facing: Dir =
    DIRECTIONS.find((dir) => sameCell(ahead(chain[0], dir), meal)) ??
    fail("the meal one step from the head", { head: chain[0], meal });

  const posed = poseScene(h, {
    obstacles: beyond,
    snake: chain,
    dir: facing,
    pellet: meal,
    pelletRespawn: true,
  });
  assertEqual(
    holdsCell(posed.obstacles, cleared),
    false,
    "the cleared cell standing clear of the obstacles the scene laid",
  );

  const drawn = await captureReplay(h, "spawned", async () => {
    const after = await h.tick();
    h.debug.setSnakeTravel(false);
    await h.tick(SETTLE);
    return after;
  });

  assertEqual(drawn.screen, "playing", "the round after the eat");
  assertDeepEqual(
    drawn.pellet,
    cleared,
    "the cell the next pellet was drawn onto, which the course had held",
  );
});
