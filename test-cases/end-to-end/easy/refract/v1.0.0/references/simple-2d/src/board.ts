// Refract — the board: cell geometry, notation, and pointer targeting.
//
// Everything here is arithmetic over `BoardState` (specs/board.md). A board is a
// grid of cells centered on (BOARD_CX, BOARD_CY) whatever its dimensions, each
// cell either empty or holding one node, and a board is written down in the
// case's one-character-per-cell notation. Nothing in this module holds state:
// a cell's stage position is derived from its address and the board's
// dimensions, and the pointer targets at most one node because NODE_HIT_R is
// below half of CELL_PITCH.

import {
  BOARD_CX,
  BOARD_CY,
  CELL_PITCH,
  CHANNELS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  NODE_HIT_R,
} from "./constants";
import type { BeamState, BoardState, Cell, Channel, NodeState } from "./game";

/** The stage x of a cell's center (specs/board.md). */
export function cellX(col: number, cols: number): number {
  return BOARD_CX - ((cols - 1) * CELL_PITCH) / 2 + col * CELL_PITCH;
}

/** The stage y of a cell's center (specs/board.md). */
export function cellY(row: number, rows: number): number {
  return BOARD_CY - ((rows - 1) * CELL_PITCH) / 2 + row * CELL_PITCH;
}

/** A cell's center on the stage, both axes at once. */
export function cellCenter(cell: Cell, board: BoardState): [number, number] {
  return [cellX(cell.col, board.cols), cellY(cell.row, board.rows)];
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * Rule R1's geometry: the two cells differ by at most 1 in column and at most 1
 * in row and are not the same cell.
 */
export function adjacent(a: Cell, b: Cell): boolean {
  return (
    Math.abs(a.col - b.col) <= 1 &&
    Math.abs(a.row - b.row) <= 1 &&
    !sameCell(a, b)
  );
}

/** The node occupying a cell, or `null` for an empty or out-of-range cell. */
export function nodeAt(
  board: BoardState,
  col: number,
  row: number,
): NodeState | null {
  for (const node of board.nodes) {
    if (node.col === col && node.row === row) return node;
  }
  return null;
}

/**
 * The node the pointer targets: the one whose cell center lies within
 * NODE_HIT_R of `(x, y)`, or `null` when no center is that close or the
 * nearest cell is empty. Only the nearest cell can qualify, because
 * NODE_HIT_R is below half of CELL_PITCH (specs/controls.md), so rounding to
 * the nearest cell address decides the candidate outright.
 */
export function targetNode(
  board: BoardState,
  x: number,
  y: number,
): NodeState | null {
  const col = Math.round((x - cellX(0, board.cols)) / CELL_PITCH);
  const row = Math.round((y - cellY(0, board.rows)) / CELL_PITCH);
  if (col < 0 || col >= board.cols || row < 0 || row >= board.rows) return null;
  const dx = x - cellX(col, board.cols);
  const dy = y - cellY(row, board.rows);
  if (Math.hypot(dx, dy) > NODE_HIT_R) return null;
  return nodeAt(board, col, row);
}

/** The channels present on a board, in the order of CHANNELS. */
export function channelsOn(board: BoardState): Channel[] {
  return CHANNELS.filter((channel) =>
    board.nodes.some((node) => node.channel === channel),
  );
}

/** One empty beam per channel present, in the order of CHANNELS. */
export function emptyBeams(board: BoardState): BeamState[] {
  return channelsOn(board).map((channel) => ({ channel, cells: [] }));
}

// ---- Notation (specs/board.md) -------------------------------------------

/** Notation character → node fields, or "empty", or undefined for garbage. */
function decode(
  char: string,
): Pick<NodeState, "kind" | "channel" | "charges"> | "empty" | undefined {
  switch (char) {
    case ".":
      return "empty";
    case "T":
      return { kind: "emitter", channel: "triangle", charges: null };
    case "S":
      return { kind: "emitter", channel: "square", charges: null };
    case "D":
      return { kind: "emitter", channel: "diamond", charges: null };
    case "t":
      return { kind: "lens", channel: "triangle", charges: null };
    case "s":
      return { kind: "lens", channel: "square", charges: null };
    case "d":
      return { kind: "lens", channel: "diamond", charges: null };
    case "1":
    case "2":
    case "3":
      return { kind: "crystal", channel: null, charges: Number(char) };
    default:
      return undefined;
  }
}

/**
 * A board from its notation, one string per row, with the well-formedness
 * specs/board.md requires checked as it is read: dimensions within
 * GRID_MAX_COLS x GRID_MAX_ROWS, every row the same length, every character one
 * of the notation's, and exactly two emitters for every channel present. An
 * invalid board throws an `Error` naming what is wrong, so a bad pose fails
 * loudly instead of producing a board the rules cannot make sense of.
 */
export function parseBoard(rows: readonly string[]): BoardState {
  if (rows.length < 1 || rows.length > GRID_MAX_ROWS) {
    throw new Error(
      `Refract: a board has 1 to ${GRID_MAX_ROWS} rows, not ${rows.length}`,
    );
  }
  const cols = rows[0].length;
  if (cols < 1 || cols > GRID_MAX_COLS) {
    throw new Error(
      `Refract: a board has 1 to ${GRID_MAX_COLS} columns, not ${cols}`,
    );
  }
  const nodes: NodeState[] = [];
  rows.forEach((line, row) => {
    if (line.length !== cols) {
      throw new Error(
        `Refract: row ${row} has ${line.length} cells; every row carries ${cols}`,
      );
    }
    for (let col = 0; col < cols; col++) {
      const decoded = decode(line[col]);
      if (decoded === undefined) {
        throw new Error(
          `Refract: "${line[col]}" at (${col}, ${row}) is not board notation`,
        );
      }
      if (decoded === "empty") continue;
      nodes.push({ col, row, ...decoded });
    }
  });

  const board: BoardState = { cols, rows: rows.length, nodes };
  for (const channel of channelsOn(board)) {
    const emitters = nodes.filter(
      (node) => node.kind === "emitter" && node.channel === channel,
    ).length;
    if (emitters !== 2) {
      throw new Error(
        `Refract: the ${channel} channel has ${emitters} emitters; ` +
          `every channel present has exactly 2`,
      );
    }
  }
  return board;
}
