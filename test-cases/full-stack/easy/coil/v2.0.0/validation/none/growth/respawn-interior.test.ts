// growth/respawn-interior — every pellet the game places is an interior cell.
//
// specs/board.md's valid set opens with it: "It is an interior cell." And the
// interior is fixed exactly — "an interior of `28 x 16` cells, `col` in `[1, 28]`
// and `row` in `[1, 16]`" — so the reading is a pair of bounds rather than a
// tolerance. A pellet on a wall cell is a pellet a player cannot reach without
// dying, and a pellet off the grid entirely is one nobody can see.
//
// THE DRAW IS POSED RATHER THAN SAMPLED. The failure this catches is an
// off-by-one at an edge: a build drawing a column in `[0, 29]`, or a row in
// `[0, 17]`, places a reachable pellet almost every time and an unreachable one
// now and then, which no bounded run of draws separates from luck. So a wall cell
// is posed as the next spawn with `setNextPellet`, whose argument
// specs/instrumentation.md makes "a cell of the grid" and which the spawn honors
// only "when the cell is in the valid set specs/board.md defines at that moment".
// A build whose valid set stops at the interior discards the pose and draws
// inside it; a build whose set runs to the edge puts the pellet on the wall it
// was handed.
//
// ONE CELL OF EACH WALL is posed in turn, over four eats along one row, because
// an off-by-one is on one side at a time: a build that stops one short at the
// left and right edges can still run one over at the top or the bottom. The meal
// for each eat is placed by hand with `setPellet`, which "is not spawning one",
// so every pellet read is one the build's own spawn placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
import {
  GRID_COLS,
  GRID_ROWS,
  INTERIOR_COL_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MAX,
  INTERIOR_ROW_MIN,
  type Cell,
} from "../constants";
import {
  ahead,
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** Ticks run after the last eat, with the chain held, so the board is seen settled. */
const SETTLE = 3;

/** The row the chain runs along, which specs/mode.md keeps clear of every course. */
const ROW = 8;

/** A cell of each of the four walls, away from the corners. */
const WALLS: readonly Cell[] = [
  { col: 0, row: ROW },
  { col: GRID_COLS - 1, row: ROW },
  { col: 15, row: 0 },
  { col: 15, row: GRID_ROWS - 1 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places every pellet inside the interior specs/board.md fixes", async () => {
  // The chain heads right along its row with the first meal one cell ahead;
  // each later meal is placed on the next cell along.
  const scene = await arrangeEat(h, {
    head: { col: 6, row: ROW },
    dir: "right",
    pelletRespawn: true,
  });

  const placed = await captureReplay(h, "interior", async () => {
    const pellets: Cell[] = [];
    let meal = scene.pellet;
    for (const wall of WALLS) {
      if (pellets.length > 0) {
        meal = ahead(meal, "right");
        await h.debug.setPellet(meal.col, meal.row);
      }
      await h.debug.setNextPellet(wall.col, wall.row);
      const after = await h.tick();
      assertNotNull(
        after.pellet,
        `a pellet placed by the eat with (${wall.col}, ${wall.row}) posed`,
      );
      pellets.push(after.pellet as Cell);
    }
    await h.debug.setSnakeTravel(false);
    await h.tick(SETTLE);
    return pellets;
  });

  for (const [index, pellet] of placed.entries()) {
    const wall = WALLS[index];
    const posed = `with the wall cell (${wall.col}, ${wall.row}) posed`;
    assertBetween(
      pellet.col,
      INTERIOR_COL_MIN,
      INTERIOR_COL_MAX,
      `the column of the pellet placed ${posed}`,
    );
    assertBetween(
      pellet.row,
      INTERIOR_ROW_MIN,
      INTERIOR_ROW_MAX,
      `the row of the pellet placed ${posed}`,
    );
  }
});
