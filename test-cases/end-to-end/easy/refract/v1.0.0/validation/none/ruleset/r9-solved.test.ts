// ruleset/r9-solved — R9: a board is solved when R6 and R7 hold for every
// channel present and R8 for every crystal; a move that satisfies R9 solves
// the board on the spot (specs/beams.md; specs/instrumentation.md: the press,
// the move, or the release is resolved in the state the call returns).
//
// THE POSE. `R9_UNIQUE`:
//
//   T...
//   ttt.
//   ...T
//
// carries an essentially unique solution — T(0,0)–t(0,1)–t(1,1)–t(2,1)–T(3,2)
// is forced up to direction — so the final permitted move of a KNOWN solution
// is exactly the last move of that route. One snapshot before it must read
// solved false on the playing screen; the snapshot taken on the very call
// that makes the move — no frame between — must read solved true with the
// game already off `playing`. That pins "evaluated after every change" to the
// move itself rather than to some later sweep.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solved flips true and the game leaves playing on the final permitted move of a known solution", async () => {
  const board = await loadBoard(h, R9_UNIQUE);

  // Everything but the last move of the forced route.
  await pressAt(h, board, { col: 0, row: 0 });
  await moveOver(h, board, { col: 0, row: 1 });
  await moveOver(h, board, { col: 1, row: 1 });
  await moveOver(h, board, { col: 2, row: 1 });
  const penultimate = await h.snapshot();

  // The final permitted move, and the state that very call returns.
  await moveOver(h, board, { col: 3, row: 2 });
  const solving = await h.snapshot();
  await h.debug.pointerUp();

  await h.advance(1);
  await captureStill(h, "solved");

  assertEqual(
    penultimate.solved,
    false,
    "one move short of the solution the board is not solved",
  );
  assertEqual(
    penultimate.screen,
    "playing",
    "one move short of the solution the game is still playing",
  );
  assertEqual(
    solving.solved,
    true,
    "solved flips true on the final permitted move",
  );
  assertNotEqual(
    solving.screen,
    "playing",
    "the game leaves playing on that same call",
  );
  assertDeepEqual(
    solving.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 3, row: 2 },
    ],
    "the solving move's segment is part of the beam the board solved with",
  );
});
