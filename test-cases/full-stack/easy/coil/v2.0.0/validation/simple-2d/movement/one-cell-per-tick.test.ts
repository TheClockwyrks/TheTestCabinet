// movement/one-cell-per-tick — a tick advances the head exactly one cell along
// `dir`, and no further.
//
// specs/movement.md fixes it twice over: "the snake moves exactly one cell per
// tick", and step 2 of the tick computes "the new head cell as the current head
// cell plus the current direction". So the reading is an exact cell rather than a
// tolerance — the simulation runs in the integer cell coordinates of
// specs/board.md and "a position between two cells never occurs".
//
// THE WORLD IS THE CHAIN AND NOTHING ELSE. The pellet is off the board, so no eat
// can lengthen the chain under the reading, and the obstacle course is cleared,
// so the run ahead of the head is open under either mode. What is left is one
// snake and one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/** Where the chain is posed: mid-board, with a long clear run to its right. */
const HEAD: Cell = { col: 10, row: 8 };

/** Ticks of clear travel before the tick this point reads. */
const RUN_UP = 3;

/** Ticks run after it, so what it left behind is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the head one cell along dir on one tick", async () => {
  const posed = arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  assertDeepEqual(posed.snapshot.snake[0], HEAD, "the posed head");
  assertEqual(posed.snapshot.dir, "right", "the posed direction");

  const run = await captureReplay(h, "move", async () => {
    const before = await h.tick(RUN_UP);
    const stepped = await h.tick();
    await h.tick(SETTLE);
    return { before, stepped };
  });
  const { before, stepped: after } = run;

  assertEqual(after.ticks, RUN_UP + 1, "ticks resolved");
  assertDeepEqual(
    after.snake[0],
    ahead(before.snake[0], "right"),
    "the head after a tick",
  );
  // And no further: a build that advanced two cells, or that advanced along some
  // other axis, is a different head cell than the one above, and a build that
  // moved the head off the grid it counts in is caught by the same reading.
  assertDeepEqual(
    after.snake[0],
    { col: before.snake[0].col + 1, row: before.snake[0].row },
    "one cell of travel, on the axis dir names",
  );
});
