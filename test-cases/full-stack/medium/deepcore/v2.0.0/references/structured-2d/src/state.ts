// Deepcore — the grid's copy-on-write.
//
// The world's game state is a LIVE object (`src/game.ts`): a tick writes the
// fields it advances in place, and the framework hands every actor, component,
// controller, and debug operation the same instance. Almost every field is
// therefore written directly, and this module exists for the one field that is
// not.
//
// THE GRID IS THE EXCEPTION, because it is the one big structure and it is read
// far more often than it is written. A marathon mine is a thousand rows of
// thirty-two cells; a `Tile` is never written to, only replaced, and a write
// replaces the one row it touches rather than the whole grid. So a frame that
// breaks a cell copies one row of thirty-two entries and shares the other
// thousand, and every reader that captured the grid keeps a coherent picture of
// the mine as it stood.

import type { DeepcoreState, Grid, Tile } from "./game";

/** One cell, or `null` where the coordinates fall outside the grid. */
export function tileAt(grid: Grid, col: number, row: number): Tile | null {
  return grid[row]?.[col] ?? null;
}

/** A grid with one cell replaced. The row it changes is the only one copied. */
export function writeTile(
  grid: Grid,
  col: number,
  row: number,
  tile: Tile,
): Grid {
  const line = grid[row];
  if (!line || col < 0 || col >= line.length) return grid;
  const rows = grid.slice();
  const next = line.slice();
  next[col] = tile;
  rows[row] = next;
  return rows;
}

/**
 * A grid with several cells replaced, each row copied once however many of its
 * cells change. A blast that clears a block goes through here rather than
 * through `writeTile` cell by cell.
 */
export function writeTiles(
  grid: Grid,
  edits: readonly { col: number; row: number; tile: Tile }[],
): Grid {
  if (edits.length === 0) return grid;
  const rows: (readonly Tile[])[] = grid.slice();
  const copied = new Map<number, Tile[]>();
  for (const edit of edits) {
    const line = rows[edit.row];
    if (!line || edit.col < 0 || edit.col >= line.length) continue;
    let next = copied.get(edit.row);
    if (!next) {
      next = line.slice();
      copied.set(edit.row, next);
      rows[edit.row] = next;
    }
    next[edit.col] = edit.tile;
  }
  return rows;
}

/** Replace one cell of the state's grid. */
export function putTile(
  state: DeepcoreState,
  col: number,
  row: number,
  tile: Tile,
): void {
  state.grid = writeTile(state.grid, col, row, tile);
}
