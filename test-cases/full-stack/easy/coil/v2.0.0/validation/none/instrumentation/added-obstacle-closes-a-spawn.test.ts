// instrumentation/added-obstacle-closes-a-spawn — a cell addObstacle laid is out
// of the valid set.
//
// specs/instrumentation.md states of the added cell that it is "fatal to the head
// and closed to a pellet spawn from the call onward, exactly as a cell of the
// laid course is". specs/board.md says the same from the valid set's side: a cell
// is drawn from only when "It is not an obstacle cell." This point is the spawn
// half; the fatal half is `instrumentation/added-obstacle-is-fatal`, and that the
// call lays the cell at all is `instrumentation/add-obstacle-lays-the-cell`.
//
// THE DRAW IS FORCED RATHER THAN SAMPLED. The interior is walked in one
// contiguous path; the chain covers the walk up to two cells short of a long tail
// of added obstacles, the meal sits on the cell between them, and one ordinary
// cell is left at the very end of the walk. A build that keeps added cells out of
// its valid set has exactly one cell to draw from and must use it. A build that
// does not has a hundred, and lands on the ordinary one about once in a hundred
// runs — so what this reads is not a coincidence either way.
//
// The course is cleared first, so every obstacle on the board is one this point
// laid and the reading cannot be about the mode's own course.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, fail } from "../assert";
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

/** Added cells laid across the tail of the walk, so a careless draw has many. */
const ADDED = 99;

/** Ticks run after the draw, with the chain held, so the board is seen settled. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the next pellet clear of every cell the call laid", async () => {
  const path = serpentine();

  // The walk's last cell is the only ordinary cell left free; the run of cells
  // before it is laid solid, and the chain covers everything before that.
  const open: Cell = path[path.length - 1];
  const added = path.slice(path.length - 1 - ADDED, path.length - 1);
  const chain = path.slice(0, path.length - 2 - ADDED).reverse();
  const meal: Cell = path[path.length - 2 - ADDED];
  const facing: Dir =
    DIRECTIONS.find((dir) => sameCell(ahead(chain[0], dir), meal)) ??
    fail("the meal one step from the head", { head: chain[0], meal });

  const posed = await poseScene(h, {
    obstacles: added,
    snake: chain,
    dir: facing,
    pellet: meal,
    pelletRespawn: true,
  });
  assertLength(posed.obstacles, ADDED, "the obstacle cells the calls laid");
  assertEqual(
    holdsCell(posed.obstacles, open),
    false,
    "the one ordinary cell left free of the added obstacles",
  );

  const drawn = await captureReplay(h, "closed", async () => {
    const after = await h.tick();
    await h.debug.setSnakeTravel(false);
    await h.tick(SETTLE);
    return after;
  });

  assertEqual(drawn.screen, "playing", "the round after the eat");
  assertEqual(
    drawn.pellet === null ? false : holdsCell(added, drawn.pellet),
    false,
    "a pellet drawn onto one of the cells addObstacle laid",
  );
  assertDeepEqual(
    drawn.pellet,
    open,
    "the cell the next pellet was drawn onto, the one cell left valid",
  );
});
