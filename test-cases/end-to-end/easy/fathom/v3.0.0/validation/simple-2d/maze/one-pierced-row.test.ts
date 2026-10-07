// maze/one-pierced-row — exactly one row is pierced, and it is a corridor row.
//
// specs/maze.md, under "A conforming maze": "The wrap tunnel. Exactly one row is
// pierced: its column `0` and column `GRID_COLS - 1` tiles are both corridor, and
// every other row carries rock in both border columns. The pierced row holds no
// den-interior tile and no den gate."
//
// THREE READINGS, and a build can break any one of them alone. A board with no
// pierced row has no tunnel and a wrap the `maze-movement` points cannot find; a
// board with several has borders it did not seal, and a forager that leaves by
// one is somewhere the maze's own geometry did not put it; and a pierced row
// carrying the den would run the tunnel straight through the chamber, which is
// the one place on the board a forager may not go.
//
// THE SIDE COLUMNS OF EVERY OTHER ROW are read here too, because the rule states
// them: a row with one open side column and rock across from it is not a tunnel
// and is not allowed to be open at all. `maze.solid-border` reads the same frame
// from the other side, and the two agree by construction — a board that breaks
// one usually breaks both, which is what a checklist of tightly focused points
// looks like.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly laid-out layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertLength } from "../assert";
import { createHarness, type Harness } from "../harness";
import {
  isDenOrGate,
  isRock,
  tileKey,
  wrapRows,
  type MazeView,
  type Tile,
} from "../maze";
import { captureBoard, freshBoards, assertLaidOut, witness } from "./boards";

/**
 * How many rows a conforming layout pierces at both borders: exactly one.
 *
 * specs/maze.md states the figure outright, so this is the specification's own
 * number rather than a bound this check chose.
 */
const PIERCED_ROWS = 1;

/** Every side-column tile of an unpierced row that is not rock. */
function unsealedSides(view: MazeView, pierced: readonly number[]): Tile[] {
  const { cols, rows } = view.grid;
  const open = new Set(pierced);
  const found: Tile[] = [];
  for (let ty = 0; ty < rows; ty += 1) {
    if (open.has(ty)) continue;
    for (const tx of [0, cols - 1]) {
      if (!isRock(view, tx, ty)) found.push({ tx, ty });
    }
  }
  return found;
}

/** Every den-interior tile and den gate standing on the rows given. */
function denOnRows(view: MazeView, rows: readonly number[]): Tile[] {
  const found: Tile[] = [];
  for (const ty of rows) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      if (isDenOrGate(view, tx, ty)) found.push({ tx, ty });
    }
  }
  return found;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("pierces exactly one row, seals the rest, and keeps the den off it", async () => {
  const boards = await freshBoards(h);
  assertLaidOut(boards);

  const measured = boards.map((board) => {
    const pierced = wrapRows(board.snapshot);
    const unsealed = unsealedSides(board.snapshot, pierced);
    const den = denOnRows(board.snapshot, pierced);
    return {
      board,
      pierced,
      unsealed,
      den,
      ok:
        pierced.length === PIERCED_ROWS &&
        unsealed.length === 0 &&
        den.length === 0,
    };
  });
  await captureBoard(h, witness(measured).board);

  for (const one of measured) {
    assertEqual(
      one.pierced.length,
      PIERCED_ROWS,
      "rows whose column 0 and column 35 tiles are both corridor in the maze " +
        `laid out as board ${one.board.ordinal}` +
        (one.pierced.length === 0 ? "" : `, at rows ${one.pierced.join(" ")}`),
    );
    assertLength(
      one.unsealed,
      0,
      "border-column tiles that are open on a row the tunnel does not pierce " +
        `in maze ${one.board.ordinal} the game laid out` +
        (one.unsealed.length === 0
          ? ""
          : `, at ${one.unsealed.map(tileKey).join(" ")}`),
    );
    assertLength(
      one.den,
      0,
      "den-interior tiles and den gates standing on the pierced row in the " +
        `maze laid out as board ${one.board.ordinal}` +
        (one.den.length === 0 ? "" : `, at ${one.den.map(tileKey).join(" ")}`),
    );
  }
});
