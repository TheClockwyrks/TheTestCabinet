// The opening board: no run under R4, at least one legal swap, every gem plain
// at strain 0 and dealt in from above.

import { describe, expect, it } from "vitest";
import { GRID_COLS, GRID_ROWS } from "../constants";
import { formatBoard, parseBoard } from "./board";
import {
  dealBoardWithoutRuns,
  dealOpeningBoard,
  isOpeningBoard,
  reserveBoard,
} from "./deal";
import { quietRows } from "./fixtures";
import { randomPicker } from "./random";
import { legalSwapExists, maximalRuns } from "./rules";

const deal = () => ({ board: dealOpeningBoard() });

describe("dealing an opening board", () => {
  it("deals a full board of plain gems at strain 0", () => {
    const { board } = deal();
    expect(board.cols).toBe(GRID_COLS);
    expect(board.rows).toBe(GRID_ROWS);
    expect(board.gems).toHaveLength(GRID_COLS * GRID_ROWS);
    for (const gem of board.gems) {
      expect(gem).not.toBeNull();
      expect(gem?.cut).toBe("plain");
      expect(gem?.strain).toBe(0);
      expect(gem?.kind).not.toBeNull();
    }
  });

  it("deals the whole board in from above, a row of travel per row", () => {
    const { board } = deal();
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        expect(board.gems[row * GRID_COLS + col]?.fell).toBe(row + 1);
      }
    }
    // The reserve board is dealt in the same way, being an opening board.
    expect(reserveBoard().gems[7 * GRID_COLS]?.fell).toBe(8);
    expect(reserveBoard().gems[0]?.fell).toBe(1);
  });

  it("holds no run under R4, and carries a legal swap, deal after deal", () => {
    for (let attempt = 1; attempt <= 200; attempt++) {
      const { board } = deal();
      expect(maximalRuns(board)).toEqual([]);
      expect(legalSwapExists(board)).toBe(true);
      expect(isOpeningBoard(board)).toBe(true);
    }
  });

  it("deals a different board from one deal to the next", () => {
    // Sixty-four cells drawn from seven kinds: two deals that agreed would be
    // a source that is not drawing at all.
    expect(formatBoard(deal().board)).not.toEqual(formatBoard(deal().board));
  });

  it("never bars more than two kinds, so the draw is never stuck", () => {
    // A board dealt with a generator that always draws the first allowed kind
    // still fills, which is the property that keeps the deal total.
    const first = { pick: <T>(items: readonly T[]): T => items[0] };
    const board = dealBoardWithoutRuns(first);
    expect(board.gems.every((gem) => gem !== null)).toBe(true);
    expect(maximalRuns(board)).toEqual([]);
  });

  it("draws the run-free half without needing a legal swap", () => {
    const board = dealBoardWithoutRuns(randomPicker);
    expect(maximalRuns(board)).toEqual([]);
  });
});

describe("the reserve board", () => {
  it("is itself an opening board, so falling back to it is safe", () => {
    const board = reserveBoard();
    expect(maximalRuns(board)).toEqual([]);
    expect(legalSwapExists(board)).toBe(true);
    expect(isOpeningBoard(board)).toBe(true);
  });

  it("is what a deal falls back to when its budget runs out", () => {
    const dealt = dealOpeningBoard(randomPicker, 0);
    expect(formatBoard(dealt)).toEqual(formatBoard(reserveBoard()));
  });

  it("is handed out fresh, so no caller can hold the one instance", () => {
    expect(reserveBoard()).not.toBe(reserveBoard());
    expect(formatBoard(reserveBoard())).toEqual(formatBoard(reserveBoard()));
  });
});

describe("recognizing an opening board", () => {
  it("accepts a board the deal produced", () => {
    expect(isOpeningBoard(deal().board)).toBe(true);
  });

  it("refuses a board carrying a run", () => {
    const rows = formatBoard(deal().board);
    const cells = rows[4].split(" ");
    const withRun = [...rows];
    withRun[4] = ["R0", "R0", "R0", ...cells.slice(3)].join(" ");
    expect(isOpeningBoard(parseBoard(withRun))).toBe(false);
  });

  it("refuses a board whose gems did not arrive clean", () => {
    const rows = formatBoard(deal().board);
    const strained = [...rows];
    strained[0] = rows[0].replace(/^(\w)0/, "$13");
    expect(isOpeningBoard(parseBoard(strained))).toBe(false);
  });

  it("refuses the quiet board, which carries no legal swap", () => {
    expect(isOpeningBoard(parseBoard(quietRows()))).toBe(false);
  });

  it("refuses a board whose gems did not come in from above", () => {
    // The notation writes every gem standing still, so a board read back out
    // of it has traveled nowhere and is not a board that was just dealt.
    expect(isOpeningBoard(parseBoard(formatBoard(deal().board)))).toBe(false);
  });
});
