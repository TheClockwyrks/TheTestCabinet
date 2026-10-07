// instrumentation/cleared-cell-is-safe — a cleared cell is safe to cross.
//
// specs/instrumentation.md says of the cells `clearObstacles` takes off that
// "they become ordinary interior cells: the head crosses them safely and a pellet
// may spawn on them". This point is the first half. That the reported list is
// emptied is `instrumentation/clear-obstacles-empties-the-list`, and the pellet
// half is `instrumentation/cleared-cell-takes-a-pellet` — three points, because a
// build that empties the list and still kills the head on one of those cells
// passes the first and fails this one.
//
// THE CELL IS TAKEN OFF THE BUILD'S OWN COURSE rather than off `MAZE_OBSTACLES`,
// because whether the laid course is the right eighteen cells is
// `board/obstacles-layout` and not this point: what this one is about is what the
// clearing did, whichever cells a build laid.
//
// THE BRACKET runs the head up to the cell over several ticks and on past it, so
// what a reviewer watches is the chain arriving at a cell the course held,
// crossing it, and carrying on.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { INTERIOR_COL_MAX, type Cell } from "../constants";
import {
  ahead,
  captureReplay,
  chainFrom,
  createHarness,
  holdsCell,
  obstacleSurface,
  poseScene,
  sameCell,
  type Harness,
} from "../harness";

/** How far the head is posed behind the cell it walks through. */
const RUNUP = 3;

/** The chain posed behind the head. */
const LENGTH = 3;

/** Ticks run after the head has crossed the cell. */
const SETTLE = 2;

/**
 * A course cell the head can be walked into from the left and out the other side,
 * with room behind the head for the chain.
 *
 * The whole interior is open once the course is cleared, so the only cells that
 * have to be free of the course are the ones the head stands on BEFORE the clear:
 * the chain's own cells.
 */
function walkable(course: readonly Cell[]): Cell {
  for (const cell of course) {
    const runup = chainFrom(
      { col: cell.col - RUNUP, row: cell.row },
      "right",
      LENGTH,
    );
    const clear =
      runup.every((c) => c.col >= 1 && !holdsCell(course, c)) &&
      cell.col + 1 + SETTLE <= INTERIOR_COL_MAX;
    if (clear) return cell;
  }
  return fail(
    "a course cell with a clear run-up from the left",
    course.length === 0 ? "a board carrying no obstacle cell at all" : course,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the head through a cell the course held", async () => {
  const laid = poseScene(h, {
    obstacles: "course",
    pellet: null,
    travel: false,
  });
  assertGreaterThan(
    laid.obstacles.length,
    0,
    "obstacle cells on the board before the call",
  );
  const cell = walkable(laid.obstacles);

  const surface = obstacleSurface(h);
  if (surface === null) {
    return fail(
      "a build whose mode lays obstacle cells to carry clearObstacles",
      "the surface carries no obstacle operations",
    );
  }
  surface.clearObstacles();

  const head = { col: cell.col - RUNUP, row: cell.row };
  h.debug.setSnake(chainFrom(head, "right", LENGTH));
  h.debug.setDirection("right");
  h.debug.clearTurns();
  h.debug.setSnakeTravel(true);

  const crossed = await captureReplay(h, "crossed", async () => {
    const onto = await h.tick(RUNUP);
    const past = await h.tick(1);
    await h.tick(SETTLE);
    return { onto, past };
  });

  assertEqual(
    sameCell(crossed.onto.snake[0], cell),
    true,
    "the head's cell on the tick it entered the cleared cell",
  );
  assertEqual(
    crossed.onto.screen,
    "playing",
    "the round the cleared cell left running",
  );
  assertEqual(
    sameCell(crossed.past.snake[0], ahead(cell, "right")),
    true,
    "the head's cell one tick further on",
  );
  assertEqual(
    crossed.past.screen,
    "playing",
    "the round after the head crossed the cell",
  );
});
