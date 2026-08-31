// Facet — keyboard/cursor-stays-on-board: a movement that would carry the
// cursor off an edge of the board leaves it exactly where it is, at each of the
// four edges.
//
// `specs/controls.md` states it in one sentence — "The cursor stays on the
// board, so a movement that would carry it off an edge leaves it where it is" —
// and the failure behind that sentence is a build that steps the cursor by
// arithmetic and never clamps the result. Two shapes of it are common and both
// are read here: a cursor that walks off the board into a cell
// `specs/board.md` does not define, so that every later reading taken from it
// (the cell `confirm` acts on, above all) names nothing; and a cursor that
// wraps around to the far edge, which is what a build reaching for a modulo
// gets, and which looks like a working cursor right up until a player at one
// edge finds themselves at the other.
//
// FOUR EDGES, TWO CORNERS. A corner is where two edges meet, so posing the
// cursor at opposite corners of the GRID_COLS x GRID_ROWS board and firing the
// two actions that lead off it from each reads all four: column 0 and row 0 at
// the first corner, the last column and the last row at the second.
//
// THE KEY REACHES THE GAME THROUGH THE ENGINE. The engine owns the keyboard and
// raises the action the build registered for the key it received, so what is
// read here is the binding table the build declared and what the build does
// with the action it is handed. The keys below are dispatched as the events the
// engine listens on, and the frame that follows each one is where the game
// reads the edge.
//
// WHAT IS DELIBERATELY NOT READ HERE. That the four actions move the cursor at
// all is what the four `keyboard/cursor-*` points are, and asserting it here as
// well would charge one build two items for one fault. This point reads the
// clamp alone, so the cursor is posed at the corner rather than walked into it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GRID_COLS, GRID_ROWS, type ActionName } from "../constants";
import type { CellRef } from "../board";
import {
  captureReplay,
  createHarness,
  poseBoardWithEscape,
  type Harness,
} from "../harness";

/**
 * Where the cursor is posed, and the actions whose step leads off the board
 * from there.
 *
 * The dimensions come from `specs/board.md` rather than from a literal, so the
 * two corners are the board's own corners whatever the figures say.
 */
const EDGES: readonly { cell: CellRef; actions: readonly ActionName[] }[] = [
  { cell: { col: 0, row: 0 }, actions: ["up", "left"] },
  {
    cell: { col: GRID_COLS - 1, row: GRID_ROWS - 1 },
    actions: ["down", "right"],
  },
];

/**
 * Frames run at rest either side of a press.
 *
 * Nothing is measured across them — the cursor is read from the game's own
 * state — but they are what makes the captured replay read as a cursor pinned
 * in a corner rather than as a marker that happened to be drawn there.
 */
const REST_FRAMES = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the cursor where it is at each of the four edges", async () => {
  // The cursor is driven on `playing`, and a posed board rests exactly as it
  // was written until a swap is accepted on it, so nothing here can move the
  // cursor except the presses.
  const posed = poseBoardWithEscape(h, []);
  assertEqual(posed.screen, "playing", "the screen the cursor is driven on");

  await captureReplay(h, "cursor", async () => {
    for (const { cell, actions } of EDGES) {
      h.debug.setCursor(cell.col, cell.row);
      await h.advance(REST_FRAMES);
      assertDeepEqual(h.snapshot().cursor, cell, "the posed corner");

      for (const action of actions) {
        // The step this action asks for leads off the board, so the whole of
        // what the cursor may do is nothing — not the far edge, and not a cell
        // outside the board's dimensions.
        await h.tapAction(action);
        await h.advance(REST_FRAMES);
        assertDeepEqual(
          h.snapshot().cursor,
          cell,
          `the cursor after ${action} at (${cell.col}, ${cell.row})`,
        );
      }
    }
  });
});
