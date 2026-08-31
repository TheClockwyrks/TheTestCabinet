// Facet — keyboard/cursor-left: the `left` action steps the cursor one column
// toward column 0, and leaves its row exactly where it was.
//
// The horizontal pair is not the vertical one rotated: `specs/board.md` lays
// the board out in rows, so a build that indexes its cells in reading order
// moves a row by a stride and a column by one, and the two are separate pieces
// of arithmetic that fail separately. This point reads the one that steps
// toward column 0 — the first column of a row — and reads that the row it
// leaves behind is untouched, which is what a build that confused a column step
// for a row step gets wrong.
//
// BOTH KEYS, EACH ON ITS OWN. `specs/controls.md` binds `left` to `ArrowLeft`
// and `KeyA` and states that each key listed for an action fires that action on
// its own, so the step is driven once per key rather than once for the action.
//
// THE KEY REACHES THE GAME THROUGH THE ENGINE. The engine owns the keyboard and
// raises the action the build registered for the key it received, so what is
// read here is the binding table the build declared and what the build does
// with the action it is handed. The keys below are dispatched as the events the
// engine listens on, and the frame that follows each one is where the game
// reads the edge.
//
// The step is driven from an interior cell, so what an edge does to a movement
// that would leave the board is `keyboard/cursor-stays-on-board`'s point and is
// not read here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureReplay,
  createHarness,
  poseBoardWithEscape,
  type Harness,
} from "../harness";

/**
 * The cell every step is driven from.
 *
 * Interior on all four sides, so a step in any direction is one the board
 * allows and the edge rule of `specs/controls.md` never comes into it, and
 * clear of the three cells the quiet filler spends on its escape swap.
 */
const START = { col: 4, row: 4 };

/**
 * Frames run at rest either side of a press.
 *
 * Nothing is measured across them — the cursor is read from the game's own
 * state — but they are what makes the captured replay read as a cursor sitting
 * still, stepping once, and sitting still again, rather than as a marker that
 * was already somewhere else.
 */
const REST_FRAMES = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("steps the cursor one column toward column 0, whichever key fires `left`", async () => {
  // The cursor is driven on `playing`, and a posed board rests exactly as it
  // was written until a swap is accepted on it, so the cursor is the only thing
  // on this board that moves.
  const posed = poseBoardWithEscape(h, []);
  assertEqual(posed.screen, "playing", "the screen the cursor is driven on");

  await captureReplay(h, "cursor", async () => {
    for (const code of BINDINGS.left) {
      // Each key is driven from the same posed cell rather than from wherever
      // the key before it left the cursor, so what is read back after a press
      // is one press's worth of movement and never two keys' worth.
      h.debug.setCursor(START.col, START.row);
      await h.advance(REST_FRAMES);
      assertDeepEqual(h.snapshot().cursor, START, `the posed cursor, before ${code}`);

      await h.tap(code);
      await h.advance(REST_FRAMES);

      // One column toward column 0, and the row untouched: the column is one
      // lower than the posed one and the row is the one the step began on.
      assertDeepEqual(
        h.snapshot().cursor,
        { col: START.col - 1, row: START.row },
        `the cursor after one ${code}`,
      );
    }
  });
});
