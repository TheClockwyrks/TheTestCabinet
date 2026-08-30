// growth/respawn-last-valid-cell — the last valid cell is still found.
//
// specs/board.md defines the valid set and says the draw over it "stays immediate
// even when very few valid cells remain, so a nearly full board picks its pellet
// without a visible stall". A build that draws cells at random and retries until
// one is valid is correct on an empty board and hangs on a full one; a build that
// gives up when its first few tries fail ends the round on the board-cleared win
// while a cell was still free. Both are this point.
//
// HOW THE BOARD IS POSED. The interior is walked in one contiguous path, the same
// boustrophedon the harness uses to fill the board. The pellet takes the first
// cell of the walk, the chain takes all of it but the first and the LAST, and the
// head is the cell adjacent to the pellet. So when the eat resolves, the chain
// covers everything except the one cell at the far end of the walk, and the valid
// set specs/board.md defines holds exactly that cell. The next pellet has one
// place to go, and this reads whether the game found it.
//
// THE OBSTACLE COURSE IS TAKEN OFF FIRST, and the snapshot is read back to confirm
// it: a course laid across the interior leaves no single contiguous path through
// the remaining cells, so there is no chain the game could have GROWN into that
// covers them. specs/instrumentation.md makes a cleared cell an ordinary interior
// cell, so the valid set the ending turns on is the whole interior under either
// mode, and the scenario reads the same for both.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, fail } from "../assert";
import { DIRECTIONS, INTERIOR_CELLS, type Cell, type Dir } from "../constants";
import {
  ahead,
  captureStill,
  clearObstacles,
  createHarness,
  sameCell,
  serpentine,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places the next pellet on the one cell the valid set still holds", async () => {
  const { debug } = h;
  const path = serpentine();
  const meal = path[0];
  const chain = path.slice(1, path.length - 1);
  const last: Cell = path[path.length - 1];

  await debug.reset();
  await clearObstacles(h);
  assertDeepEqual(
    (await h.snapshot()).obstacles,
    [],
    "the obstacle cells the valid set has to exclude",
  );

  await debug.setSnake(chain);
  const facing: Dir =
    DIRECTIONS.find((dir) => sameCell(ahead(chain[0], dir), meal)) ??
    fail("the meal one step from the head", { head: chain[0], meal });
  await debug.setDirection(facing);
  await debug.clearTurns();
  await debug.setPellet(meal.col, meal.row);
  await debug.setPelletRespawn(true);
  await debug.setScreen("playing");

  const posed = await h.snapshot();
  assertLength(posed.snake, INTERIOR_CELLS - 2, "the chain covering all but two cells");

  const after = await h.tick();
  // The board the reading is taken off, kept as the point's evidence.
  await captureStill(h, "last");

  assertLength(after.snake, INTERIOR_CELLS - 1, "the chain after the eat");
  assertEqual(after.screen, "playing", "the round after the eat");
  assertDeepEqual(after.pellet, last, "the pellet on the last valid cell");
});
