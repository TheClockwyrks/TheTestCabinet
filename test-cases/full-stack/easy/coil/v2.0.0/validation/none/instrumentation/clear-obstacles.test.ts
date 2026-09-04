// instrumentation/clear-obstacles — the course comes off the board at one call,
// and what comes off is the course alone.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `clearObstacles`
// as taking "every obstacle cell off the board at once, leaving `obstacles`
// empty", and says of the cells that "they become ordinary interior cells: the
// head crosses them safely and a pellet may spawn on them", and of the border
// that it "is untouched, because the border is the board's edge rather than an
// obstacle".
//
// SO THERE ARE TWO HALVES TO READ, and a build can fail either while passing the
// other. A build that empties the reported list without making the cells ordinary
// still kills the head on one; a build that clears the border along with the
// course opens the board's edge. The list read decides the first sentence, the
// head walking THROUGH a cell the course held decides the second, and the head
// then carrying on into the wall decides the third.
//
// THE COURSE IS READ OFF THE BUILD rather than off `MAZE_OBSTACLES`, because
// whether the laid course is the right eighteen cells is `board/obstacles-layout`
// and not this point: what this one is about is the operation that takes them
// away, whichever cells a build laid.
//
// A build whose mode lays no obstacle cell carries no `clearObstacles`, and this
// point belongs only to the mode that does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength, fail } from "../assert";
import { type Cell, INTERIOR_COL_MAX } from "../constants";
import {
  ahead,
  captureStill,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * A course cell the head can be walked into from the left and out the other side
 * to the right wall, with room behind the head for the chain.
 *
 * The whole interior is open once the course is cleared, so the only cells that
 * have to be free of the course are the ones the head stands on BEFORE the clear:
 * the chain's own cells. Everything to the right of the cell is reachable
 * afterwards whatever the course was.
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
      cell.col < INTERIOR_COL_MAX;
    if (clear) return cell;
  }
  return fail(
    "a course cell with a clear run-up from the left",
    course.length === 0 ? "a board carrying no obstacle cell at all" : course,
  );
}

it("empties the course, opens the cells it held, and leaves the border", async () => {
  const laid = await poseScene(h, {
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

  const surface = await obstacleSurface(h);
  if (surface === null) {
    return fail(
      "a build whose mode lays obstacle cells to carry clearObstacles",
      "the surface carries no obstacle operations",
    );
  }
  await surface.clearObstacles();

  const head = { col: cell.col - RUNUP, row: cell.row };
  await h.debug.setSnake(chainFrom(head, "right", LENGTH));
  await h.debug.setDirection("right");
  await h.debug.clearTurns();
  await h.debug.setSnakeTravel(true);
  await h.advance(1);
  await captureStill(h, "cleared");

  const cleared = await h.snapshot();
  assertLength(cleared.obstacles, 0, "the obstacle cells left on the board");

  // The head walks onto the cell the course held, and off it again.
  const onto = await h.tick(RUNUP);
  assertEqual(sameCell(onto.snake[0], cell), true, "the head's cell");
  assertEqual(onto.screen, "playing", "the round the cleared cell left");
  const past = await h.tick(1);
  assertEqual(
    sameCell(past.snake[0], ahead(cell, "right")),
    true,
    "the head's cell one tick further on",
  );
  assertEqual(past.screen, "playing", "the round after crossing the cell");

  // The border is not an obstacle, so clearing the course leaves it fatal.
  const wall = await h.until((s) => s.screen !== "playing", { maxTicks: 40 });
  assertEqual(wall.hit, true, "the round ending against the wall");
  assertEqual(wall.snapshot.screen, "gameover", "the screen the wall reached");
});
