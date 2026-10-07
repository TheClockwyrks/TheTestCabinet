// growth/respawn-off-snake — no pellet the game places lands on the snake.
//
// specs/board.md's valid set: "It holds no snake segment." A pellet under the
// chain is one the player cannot eat and, worse, one they cannot see, so the
// round stalls with nothing on the board to go for.
//
// THE DRAW IS POSED RATHER THAN SAMPLED. A build that draws a cell without
// testing it against the chain misses a short chain by chance on almost every
// draw, which no bounded run separates from luck. So a cell the chain holds is
// posed as the next spawn with `setNextPellet`, which the spawn honors only
// "when the cell is in the valid set specs/board.md defines at that moment". A
// build that keeps the chain out of its valid set discards the pose and draws
// elsewhere; a build that does not puts the pellet under the chain it was
// handed.
//
// AGAINST A DELIBERATELY LONG CHAIN, laid along the harness's walk over the
// interior, because a chain of sixty is the shape the rule is worded against
// rather than the three cells a round opens with. The posed cell is deep in the
// body, occupied before the eat and after it, rather than the tail, which the
// tick that eats leaves standing either way. The meal is placed by hand with
// `setPellet`, which "is not spawning one", so the pellet read is the one the
// build's own spawn placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import type { Cell, Dir } from "../constants";
import {
  captureReplay,
  createHarness,
  holdsCell,
  poseScene,
  serpentine,
  type Harness,
} from "../harness";

/** Cells of the posed chain, taken from the start of the interior walk. */
const LENGTH = 60;

/** Ticks run after the eat, with the chain held, so the board is seen settled. */
const SETTLE = 3;

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

it("never places a pellet on a cell the chain holds", async () => {
  // The first `LENGTH` cells of the walk, head last, with the meal on the cell
  // the walk reaches next, so the eat is one tick along a known path.
  const walk = serpentine();
  const chain = walk.slice(0, LENGTH).reverse();
  const meal = walk[LENGTH];
  const body = chain[Math.floor(LENGTH / 2)];
  poseScene(h, {
    snake: chain,
    dir: facing(chain[0], meal),
    pellet: meal,
    pelletRespawn: true,
  });
  h.debug.setNextPellet(body.col, body.row);

  const after = await captureReplay(h, "clear", async () => {
    const eaten = await h.tick();
    h.debug.setSnakeTravel(false);
    await h.tick(SETTLE);
    return eaten;
  });

  assertEqual(
    holdsCell(after.snake, body),
    true,
    "the posed cell still held by the chain at the spawn",
  );
  assertNotNull(after.pellet, "a pellet placed by the eat");
  const pellet = after.pellet as Cell;
  assertEqual(
    holdsCell(after.snake, pellet),
    false,
    `the pellet placed at (${pellet.col}, ${pellet.row}) with the body cell (${body.col}, ${body.row}) posed, against a chain of ${after.snake.length}`,
  );
});
