// instrumentation/cleared-board-keeps-its-border — clearing the course leaves the
// wall border where it is.
//
// specs/instrumentation.md says of `clearObstacles` that "the wall border is
// untouched, because the border is the board's edge rather than an obstacle". A
// build that treats its border as one more row of obstacle cells empties it along
// with the course and opens the edge of the board, which is the failure this
// point is about.
//
// IT IS ITS OWN POINT because nothing else reaches it. The `collision/wall-*`
// points decide the border of an ordinary round and never call
// `clearObstacles`, so a build that clears the border with the course passes
// every one of them. The two halves of what the call DOES open — the reported
// list and the cells it held — are
// `instrumentation/clear-obstacles-empties-the-list` and
// `instrumentation/cleared-cell-is-safe`.
//
// THE COURSE IS LAID FIRST and read back, so a board that was empty all along
// cannot pass by having had nothing to clear. The scene that follows asks for a
// cleared board, which is `clearObstacles` again, and the chain is laid on that
// board.
//
// THE BRACKET runs the chain up to the border and past the death, so a reviewer
// sees the head crossing a board with no course on it and stopping at the edge.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  WALL_CELL,
  arrangeApproach,
  captureReplay,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** Ticks of clear travel before the head reaches the border. */
const RUN_UP = 3;

/** Ticks run after the death, so the screen it opened is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the round on the border of a board whose course was cleared", async () => {
  const laid = poseScene(h, { obstacles: "course", pellet: null });
  assertGreaterThan(
    laid.obstacles.length,
    0,
    "obstacle cells on the board of a mode that lays a course",
  );

  const posed = arrangeApproach(h, WALL_CELL, {
    obstacles: "cleared",
    dir: "left",
    length: 3,
    runUp: RUN_UP + 1,
  });
  assertLength(
    posed.snapshot.obstacles,
    0,
    "the obstacle cells left on the board",
  );
  assertEqual(posed.snapshot.screen, "playing", "the round before the tick");

  const met = await captureReplay(h, "border", async () => {
    const travelled = await h.tick(RUN_UP);
    const fatal = await h.tick();
    await h.tick(SETTLE);
    return { travelled, fatal };
  });

  assertEqual(
    met.travelled.screen,
    "playing",
    "the round on the way to the border",
  );
  assertDeepEqual(
    met.travelled.snake[0],
    { col: WALL_CELL.col + 1, row: WALL_CELL.row },
    "the head's cell the tick before the border",
  );
  assertEqual(
    met.fatal.screen,
    "gameover",
    "the screen the border reached on a cleared board",
  );
});
