// The opening board: no run under R4, at least one legal swap, and the same
// board every time from the same seed.

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
import { cursor } from "./rng";
import { legalSwapExists, maximalRuns } from "./rules";

const deal = (seed: number) => dealOpeningBoard(seed);

describe("dealing an opening board", () => {
  it("deals a full board of plain gems at strain 0", () => {
    const { board } = deal(1);
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

  it("holds no run under R4, and carries a legal swap, from any seed", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { board } = deal(seed);
      expect(maximalRuns(board)).toEqual([]);
      expect(legalSwapExists(board)).toBe(true);
      expect(isOpeningBoard(board)).toBe(true);
    }
  });

  it("deals the same board from the same seed, and another from another", () => {
    expect(formatBoard(deal(7).board)).toEqual(formatBoard(deal(7).board));
    expect(formatBoard(deal(7).board)).not.toEqual(formatBoard(deal(8).board));
  });

  it("hands back the generator state the deal left", () => {
    const dealt = deal(7);
    expect(dealt.rngState).not.toBe(7);
    // Dealing again from that state gives the board a second deal would.
    const again = dealOpeningBoard(dealt.rngState);
    expect(formatBoard(again.board)).not.toEqual(formatBoard(dealt.board));
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
    const board = dealBoardWithoutRuns(cursor(5));
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
    const dealt = dealOpeningBoard(7, 0);
    expect(formatBoard(dealt.board)).toEqual(formatBoard(reserveBoard()));
    expect(dealt.rngState).toBe(7);
  });

  it("is handed out fresh, so no caller can hold the one instance", () => {
    expect(reserveBoard()).not.toBe(reserveBoard());
    expect(formatBoard(reserveBoard())).toEqual(formatBoard(reserveBoard()));
  });
});

describe("recognizing an opening board", () => {
  it("accepts a board the deal produced", () => {
    expect(isOpeningBoard(deal(1).board)).toBe(true);
  });

  it("refuses a board carrying a run", () => {
    const rows = formatBoard(deal(1).board);
    const cells = rows[4].split(" ");
    const withRun = [...rows];
    withRun[4] = ["R0", "R0", "R0", ...cells.slice(3)].join(" ");
    expect(isOpeningBoard(parseBoard(withRun))).toBe(false);
  });

  it("refuses a board whose gems did not arrive clean", () => {
    const rows = formatBoard(deal(1).board);
    const strained = [...rows];
    strained[0] = rows[0].replace(/^(\w)0/, "$13");
    expect(isOpeningBoard(parseBoard(strained))).toBe(false);
  });

  it("refuses the quiet board, which carries no legal swap", () => {
    expect(isOpeningBoard(parseBoard(quietRows()))).toBe(false);
  });
});
