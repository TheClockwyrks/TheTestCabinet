// instrumentation/add-obstacle — one call lays one obstacle cell, and the cell it
// lays is as fatal as a cell of the course.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words
// `addObstacle(state, col, row)` as adding "one obstacle cell at `(col, row)`",
// and states of it that "the added cell is fatal to the head and closed to a
// pellet spawn from the call onward, exactly as a cell of the laid course is".
// specs/mode.md is what "exactly as" points at: "an obstacle cell is fatal to the
// head, exactly as a wall cell is. Step 3 of the tick ends the round when the new
// head cell is one of them." specs/ui.md names the screen a fatal collision
// reaches: `gameover`.
//
// WHY THE COURSE IS CLEARED FIRST. The claim is about ONE cell — the one the call
// named — so the board this poses holds exactly that one and nothing else, and
// the list read afterwards can say so outright rather than say the list grew by
// one. That also keeps this point clear of `board/obstacles-layout`, which is
// where the laid course is decided. `arrangeStep` with an explicit `obstacles`
// list is that clear-then-lay, spent through the surface's own two operations.
//
// This point reads the operation by what it DID to the board rather than by its
// presence: a build that carries the name and lays nothing fails the list read,
// and a build that lays a cell the head walks through fails the drive.
//
// A build whose mode lays no obstacle cell carries no `addObstacle`, and this
// point belongs only to the mode that does.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  arrangeStep,
  captureReplay,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/** Where the head is posed. Row 8 is the row specs/mode.md keeps clear. */
const HEAD: Cell = { col: 10, row: 8 };

/** The one cell the call lays: directly ahead of the head. */
const OBSTACLE: Cell = { col: 11, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays one obstacle at the named cell, and the head dies on it", async () => {
  const posed = arrangeStep(h, {
    obstacles: [OBSTACLE],
    head: HEAD,
    dir: "right",
    length: 3,
  });

  assertLength(
    posed.snapshot.obstacles,
    1,
    "the obstacle cells on the board after one addObstacle over a cleared course",
  );
  assertDeepEqual(
    posed.snapshot.obstacles[0],
    OBSTACLE,
    "the cell the call laid",
  );
  assertDeepEqual(posed.next, OBSTACLE, "the cell the next tick enters");
  assertEqual(posed.snapshot.screen, "playing", "the round before the tick");

  const after = await captureReplay(h, "added", () => h.tick());

  assertEqual(after.ticks, 1, "ticks resolved");
  assertEqual(after.screen, "gameover", "the screen the added cell reached");
});
