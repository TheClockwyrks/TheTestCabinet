// growth/respawn-varies — the respawn cell is drawn rather than fixed.
//
// specs/board.md: "A pellet spawns at a uniformly random cell drawn from the
// valid set." A build that always answers the same cell satisfies every other
// rule of the valid set and makes an unplayable game: the route from one pellet
// to the next never changes, so the combo that specs/scoring.md builds the game
// around is a memorised loop.
//
// WHAT IS READ, AND WHY IT IS NOT A DISTRIBUTION. Randomness cannot be decided
// from a sample without a statistic, and a statistic over a build's own draws
// would fail a conformant build now and then. What the specification supports
// without qualification is that the draw MOVES: over twenty eats, the cells the
// game chose are not all one cell. That is the failure worth naming, and a build
// drawing uniformly from a valid set of hundreds of cells lands twenty draws on
// one cell with a probability far too small to ever cost it the point.
//
// HOW THE RUN IS DRIVEN. Every tick eats, along the harness's walk over the
// interior, so the chain after `k` eats is exactly the first `START + k` cells
// of that walk, laid head-last: consecutive cells are adjacent by construction,
// no cell repeats, and the cell each eat enters is free because the walk has not
// reached it yet. The meal is placed by hand each tick with `setPellet`, which
// specs/instrumentation.md says "is not spawning one: no draw is made", so the
// head is steered along a known path without touching the draw under test, and
// nothing is posed for the spawn. What is recorded is the pellet the game itself
// placed at step 5.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull } from "../assert";
import type { Cell, Dir } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScene,
  serpentine,
  type Harness,
} from "../harness";

/** Cells of the interior walk the chain starts as. */
const START = 3;

/** Draws the game makes over the run. */
const EATS = 20;

/** The direction from `from` to the orthogonally adjacent cell `to`. */
function facing(from: Cell, to: Cell): Dir {
  if (to.col > from.col) return "right";
  if (to.col < from.col) return "left";
  return to.row > from.row ? "down" : "up";
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Drive `EATS` real eats along the walk, and keep the cell each spawn chose. */
async function driveEats(): Promise<Cell[]> {
  const walk = serpentine();
  poseScene(h, {
    snake: walk.slice(0, START).reverse(),
    dir: facing(walk[START - 1], walk[START]),
    pellet: null,
    pelletRespawn: true,
  });

  const placed: Cell[] = [];
  for (let eat = 0; eat < EATS; eat += 1) {
    const head = walk[START + eat - 1];
    const meal = walk[START + eat];
    h.debug.setDirection(facing(head, meal));
    h.debug.setPellet(meal.col, meal.row);
    const after = await h.tick();
    assertNotNull(after.pellet, `a replacement pellet after eat ${eat + 1}`);
    placed.push(after.pellet as Cell);
  }
  return placed;
}

it("places its pellets on more than one distinct cell", async () => {
  const placed = await captureReplay(h, "varied", driveEats);

  const distinct = new Set(placed.map(({ col, row }) => `${col},${row}`));
  assertGreaterThan(
    distinct.size,
    1,
    `distinct cells across ${EATS} pellets the game placed`,
  );
});
