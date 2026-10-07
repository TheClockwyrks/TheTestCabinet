// The board: cell geometry, notation, and pointer targeting.

import { describe, expect, it } from "vitest";
import {
  adjacent,
  cellX,
  cellY,
  channelsOn,
  emptyBeams,
  nodeAt,
  parseBoard,
  targetNode,
} from "./board";
import {
  BOARD_CX,
  BOARD_CY,
  CELL_PITCH,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  NODE_HIT_R,
} from "./constants";

describe("cell geometry", () => {
  it("centers a board on (BOARD_CX, BOARD_CY) whatever its dimensions", () => {
    // A 1x1 board's single cell sits exactly on the board center.
    expect(cellX(0, 1)).toBe(BOARD_CX);
    expect(cellY(0, 1)).toBe(BOARD_CY);
    // An even-sized board straddles it, half a pitch to each side.
    expect(cellX(0, 2)).toBe(BOARD_CX - CELL_PITCH / 2);
    expect(cellX(1, 2)).toBe(BOARD_CX + CELL_PITCH / 2);
  });

  it("spans the figures specs/board.md states for the largest board", () => {
    expect(cellX(0, GRID_MAX_COLS)).toBe(352);
    expect(cellX(GRID_MAX_COLS - 1, GRID_MAX_COLS)).toBe(928);
    expect(cellY(0, GRID_MAX_ROWS)).toBe(152);
    expect(cellY(GRID_MAX_ROWS - 1, GRID_MAX_ROWS)).toBe(632);
  });

  it("holds adjacent centers CELL_PITCH apart on both axes", () => {
    expect(cellX(3, 5) - cellX(2, 5)).toBe(CELL_PITCH);
    expect(cellY(2, 4) - cellY(1, 4)).toBe(CELL_PITCH);
  });

  it("reads 8-adjacency and refuses the same cell", () => {
    const cell = { col: 2, row: 2 };
    expect(adjacent(cell, { col: 3, row: 3 })).toBe(true);
    expect(adjacent(cell, { col: 2, row: 1 })).toBe(true);
    expect(adjacent(cell, { col: 2, row: 2 })).toBe(false);
    expect(adjacent(cell, { col: 4, row: 2 })).toBe(false);
  });
});

describe("notation", () => {
  it("parses the worked example from specs/board.md", () => {
    const board = parseBoard(["T.S", "1.s", "T.S"]);
    expect(board.cols).toBe(3);
    expect(board.rows).toBe(3);
    expect(board.nodes).toHaveLength(6);
    expect(nodeAt(board, 0, 0)).toMatchObject({
      kind: "emitter",
      channel: "triangle",
      charges: null,
    });
    expect(nodeAt(board, 0, 1)).toMatchObject({
      kind: "crystal",
      channel: null,
      charges: 1,
    });
    expect(nodeAt(board, 2, 1)).toMatchObject({
      kind: "lens",
      channel: "square",
    });
    expect(nodeAt(board, 1, 1)).toBeNull();
    expect(channelsOn(board)).toEqual(["triangle", "square"]);
  });

  it("lists nodes in reading order, top-left to bottom-right", () => {
    const board = parseBoard(["T.S", "1.s", "T.S"]);
    const cells = board.nodes.map((node) => [node.col, node.row]);
    expect(cells).toEqual([
      [0, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [2, 2],
    ]);
  });

  it("refuses a character outside the notation", () => {
    expect(() => parseBoard(["TxT"])).toThrow(/"x"/);
  });

  it("refuses ragged rows", () => {
    expect(() => parseBoard(["TT", "T"])).toThrow(/row 1/);
  });

  it("refuses a board past the grid bounds", () => {
    expect(() => parseBoard(["T".repeat(8)])).toThrow(/columns/);
    expect(() => parseBoard(Array(7).fill("TT"))).toThrow(/rows/);
    expect(() => parseBoard([])).toThrow(/rows/);
  });

  it("refuses a channel without exactly two emitters", () => {
    expect(() => parseBoard(["T.t"])).toThrow(/triangle.*1 emitters/);
    expect(() => parseBoard(["TTT"])).toThrow(/triangle.*3 emitters/);
    // A lens-only channel is a channel present with zero emitters.
    expect(() => parseBoard(["TsT"])).toThrow(/square.*0 emitters/);
  });

  it("builds one empty beam per channel present, in CHANNELS order", () => {
    const board = parseBoard(["D.D", "S.S"]);
    expect(emptyBeams(board)).toEqual([
      { channel: "square", cells: [] },
      { channel: "diamond", cells: [] },
    ]);
  });
});

describe("pointer targeting", () => {
  const board = parseBoard(["T.S", "1.s", "T.S"]);
  const x0 = cellX(0, board.cols);
  const y0 = cellY(0, board.rows);

  it("targets the node within NODE_HIT_R of its cell center", () => {
    expect(targetNode(board, x0, y0)).toMatchObject({ col: 0, row: 0 });
    expect(targetNode(board, x0 + NODE_HIT_R, y0)).toMatchObject({
      col: 0,
      row: 0,
    });
  });

  it("targets nothing just past NODE_HIT_R", () => {
    // Diagonally away, so no neighboring center comes in range instead.
    const offset = (NODE_HIT_R + 0.5) / Math.SQRT2;
    expect(targetNode(board, x0 - offset, y0 - offset)).toBeNull();
  });

  it("targets nothing over an empty cell", () => {
    expect(targetNode(board, cellX(1, board.cols), y0)).toBeNull();
  });

  it("targets nothing off the board", () => {
    expect(targetNode(board, x0 - CELL_PITCH, y0)).toBeNull();
    expect(targetNode(board, 0, 0)).toBeNull();
  });
});
