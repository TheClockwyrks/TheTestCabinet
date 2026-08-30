// states/cleared-reachable — filling the board ends the round on `cleared`.
//
// specs/movement.md gives a round a second ending: "Board cleared — Step 5 found
// no valid cell for the next pellet, as `specs/board.md` defines the valid set."
// specs/board.md says the same from its side: "When the snake has grown until the
// valid set is empty, no pellet can spawn and the round ends on the board-cleared
// win."
//
// The ending is driven rather than posed. The chain is laid along a path through
// every interior cell but one, the pellet is put on that one cell directly ahead
// of the head, and a single tick eats it: the eat grows the chain onto the last
// free cell and step 5 then looks for somewhere to put the next pellet and finds
// nowhere. What decides the round is the build's own valid set.
//
// `arrangeFullBoard` clears the obstacle course first, so the valid set the
// ending turns on is the whole interior under either mode
// (specs/instrumentation.md makes a cleared obstacle cell an ordinary interior
// cell).

import { afterEach, beforeEach, it } from "vitest";
import {
  INTERIOR_MAX_COL,
  INTERIOR_MAX_ROW,
  INTERIOR_MIN_COL,
  INTERIOR_MIN_ROW,
} from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  arrangeFullBoard,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The interior the one-cell border encloses: 28 x 16 cells (specs/board.md). */
const INTERIOR_CELLS =
  (INTERIOR_MAX_COL - INTERIOR_MIN_COL + 1) *
  (INTERIOR_MAX_ROW - INTERIOR_MIN_ROW + 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen to cleared on the tick that fills the last cell", async () => {
  const posed = arrangeFullBoard(h);
  assertLength(
    posed.snapshot.snake,
    INTERIOR_CELLS - 1,
    "the chain one cell short of the interior",
  );

  await h.tick();
  captureStill(h, "cleared");

  const ended = h.snapshot();
  assertEqual(ended.screen, "cleared", "the screen the filled board ended on");
  assertLength(ended.snake, INTERIOR_CELLS, "the chain the round ended with");
});
