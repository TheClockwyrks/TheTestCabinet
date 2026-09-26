// board/obstacles-fatal — the head entering a cell of the course ends the round.
//
// WHAT THE SPECIFICATION FIXES. specs/mode.md: "An obstacle cell is fatal to the
// head, exactly as a wall cell is. Step 3 of the tick ends the round when the new
// head cell is one of them." specs/board.md calls an obstacle cell "Solid, and
// fatal to the head on contact", and specs/movement.md's step 3 ends the round
// "at once, with no grace tick and no second chance". specs/ui.md names the
// screen a fatal collision reaches: `gameover`.
//
// THE CELL IS TAKEN OFF THE BUILD'S OWN COURSE, not off `OBSTACLE_CELLS`. What
// this point decides is whether an obstacle kills, and a build that laid the
// wrong eighteen cells should lose `board/obstacles-layout` for that and be
// graded here on the course it actually laid. The cell chosen is one with a clear
// run-up: the chain has to be laid on cells carrying no obstacle, so the approach
// is picked from the four directions rather than assumed.
//
// THE WORLD IS THE COURSE AND THE CHAIN. The pellet is off the board, so the tick
// that resolves is the collision and nothing else; the course is kept, because the
// course is what the point is about.
//
// The Classic mode lays no obstacle cell, and this point belongs only to the mode
// that lays a course.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import {
  ahead,
  captureReplay,
  chainFrom,
  createHarness,
  DIRECTIONS,
  holdsCell,
  isInterior,
  OPPOSITE,
  poseScene,
  type Cell,
  type Dir,
  type Harness,
} from "../harness";

/** The chain posed behind the head. */
const LENGTH = 3;

/** A course cell and the direction a chain can be laid to approach it from. */
interface Approach {
  cell: Cell;
  dir: Dir;
}

/**
 * A cell of the laid course the head can be walked into.
 *
 * The chain occupies `LENGTH` cells behind the head, and specs/instrumentation.md
 * requires every cell of a posed chain to be an interior cell carrying no
 * obstacle, so an approach is usable only when the whole run-up is clear of the
 * course. The four bars specs/mode.md fixes leave every one of their cells open
 * from at least one side, so this finds one; a build that laid a course with no
 * approachable cell at all cannot be asked this question.
 */
function approachable(course: readonly Cell[]): Approach {
  for (const cell of course) {
    for (const dir of DIRECTIONS) {
      const head = ahead(cell, OPPOSITE[dir]);
      const chain = chainFrom(head, dir, LENGTH);
      const clear = chain.every(
        (c) => isInterior(c.col, c.row) && !holdsCell(course, c),
      );
      if (clear) return { cell, dir };
    }
  }
  return fail(
    "a cell of the laid course with a clear run-up on some side",
    course.length === 0 ? "a board carrying no obstacle cell at all" : course,
  );
}

/** Ticks run after the tick this point reads, so its outcome is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the round on the tick the head enters a course cell", async () => {
  const laid = poseScene(h, { obstacles: "course", pellet: null });
  const { cell, dir } = approachable(laid.obstacles);

  const posed = poseScene(h, {
    obstacles: "course",
    snake: chainFrom(ahead(cell, OPPOSITE[dir]), dir, LENGTH),
    dir,
    pellet: null,
  });
  assertDeepEqual(
    ahead(posed.snake[0], dir),
    cell,
    "the cell the next tick enters",
  );
  assertEqual(posed.screen, "playing", "the round before the tick");

  const after = await captureReplay(h, "obstacle", async () => {
    const resolved = await h.tick();
    await h.tick(SETTLE);
    return resolved;
  });

  assertEqual(after.ticks, 1, "ticks resolved");
  assertEqual(after.screen, "gameover", "the screen the obstacle reached");
});
