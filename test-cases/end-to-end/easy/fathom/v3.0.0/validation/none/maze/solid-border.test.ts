// maze/solid-border — the border is solid but for the tunnel.
//
// specs/maze.md, under "A conforming maze": "A solid border. Row `0`, row
// `GRID_ROWS - 1`, column `0` and column `GRID_COLS - 1` are rock at every
// position except the two mouths of the wrap tunnel." So the tunnel is the only
// way off the grid, and a hole anywhere else on the frame is a corridor that
// leads nowhere a body can come back from.
//
// A BORDER TILE IS ALLOWED TO BE OPEN IN EXACTLY ONE PLACE: the two side-column
// mouths of a pierced row. Every other opening on the four lines is counted as a
// breach, wherever it sits — a gap in the top row, a gap in the bottom row, and a
// side-column tile on a row that is not pierced at both ends. That the piercing
// happens on exactly ONE row is `maze.one-pierced-row`'s claim rather than this
// one's, so a board that pierced several still fails there and is judged here
// only on the frame outside them.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly seeded layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach, it } from "vitest";

import { assertLength } from "../assert";
import { createHarness, type Harness } from "../harness";
import { isRock, tileKey, wrapRows, type MazeView, type Tile } from "../maze";
import { captureBoard, freshBoards, requireLaidOut, witness } from "./boards";

/**
 * Every border tile of `view` that is not rock and is not a tunnel mouth.
 *
 * A mouth is a tile in column `0` or column `cols - 1` on a row whose two border
 * tiles are BOTH open, which is what specs/maze.md means by "the two mouths of
 * the wrap tunnel". A side-column hole with rock across from it is not a tunnel,
 * and is counted.
 */
function borderBreaches(view: MazeView): Tile[] {
  const { cols, rows } = view.grid;
  const pierced = new Set(wrapRows(view));
  const breaches: Tile[] = [];
  const consider = (tx: number, ty: number): void => {
    if (isRock(view, tx, ty)) return;
    const mouth = (tx === 0 || tx === cols - 1) && pierced.has(ty);
    if (!mouth) breaches.push({ tx, ty });
  };
  for (let tx = 0; tx < cols; tx += 1) {
    consider(tx, 0);
    consider(tx, rows - 1);
  }
  for (let ty = 1; ty < rows - 1; ty += 1) {
    consider(0, ty);
    consider(cols - 1, ty);
  }
  return breaches;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays out a maze whose only opening on the frame is the wrap tunnel", async () => {
  const boards = await freshBoards(h);
  requireLaidOut(boards);

  const measured = boards.map((board) => {
    const breaches = borderBreaches(board.snapshot);
    return { board, breaches, ok: breaches.length === 0 };
  });
  await captureBoard(h, witness(measured).board);

  for (const one of measured) {
    assertLength(
      one.breaches,
      0,
      "border tiles that are neither rock nor a mouth of the wrap tunnel in " +
        `the maze laid out from seed ${one.board.seed}` +
        (one.breaches.length === 0
          ? ""
          : `, at ${one.breaches.map(tileKey).join(" ")}`),
    );
  }
});
