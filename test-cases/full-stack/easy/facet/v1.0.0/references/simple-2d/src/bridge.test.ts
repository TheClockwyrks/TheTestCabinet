import { describe, expect, it } from "vitest";
import {
  emptyCell,
  fromCore,
  fromCoreBoard,
  isEmptyCell,
  toCore,
  toCoreBoard,
  toCoreGem,
} from "./bridge";
import { GRID_COLS, GRID_ROWS } from "./constants";
import {
  createInitialState,
  EMPTY_BOARD,
  loadBoard,
  parseBoard,
  poseSwap,
  startRound,
  withGem,
  type FacetState as CoreState,
} from "./core";
import { quietRowsWith } from "./core/fixtures";

/** A round in progress, with a board, a chain, a selection, and a refusal. */
function busy(): CoreState {
  const posed = loadBoard(
    startRound(createInitialState()),
    quietRowsWith({ "1,1": "R0", "2,1": "R0", "3,1": "C0", "3,2": "R0" }),
  );
  return poseSwap(posed, 3, 1, 3, 2);
}

describe("a cell that holds no gem", () => {
  it("is written as the one gem the notation cannot make", () => {
    // A kindless gem is a prism, and a prism's cut says so, so `kind: null`
    // with `cut: "plain"` names no gem and is free to mean "empty".
    expect(isEmptyCell(emptyCell(3, 4))).toBe(true);
    expect(toCoreGem(emptyCell(3, 4))).toBeNull();
  });

  it("is not confused with a prism, which is a gem", () => {
    const prism = {
      col: 0,
      row: 0,
      kind: null,
      cut: "prism",
      strain: 2,
      fell: 3,
    } as const;
    expect(isEmptyCell(prism)).toBe(false);
    expect(toCoreGem(prism)).toEqual({
      kind: null,
      cut: "prism",
      strain: 2,
      fell: 3,
    });
  });

  it("round-trips through the board in both directions", () => {
    const board = withGem(
      parseBoard(quietRowsWith({})),
      { col: 2, row: 5 },
      null,
    );
    const declared = fromCoreBoard(board);
    expect(isEmptyCell(declared.cells[5 * GRID_COLS + 2])).toBe(true);
    expect(toCoreBoard(declared)).toEqual(board);
  });
});

describe("the board", () => {
  it("carries one cell per grid position, in reading order", () => {
    const declared = fromCoreBoard(parseBoard(quietRowsWith({})));
    expect(declared.cols).toBe(GRID_COLS);
    expect(declared.rows).toBe(GRID_ROWS);
    expect(declared.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    declared.cells.forEach((cell, index) => {
      expect(cell.col).toBe(index % GRID_COLS);
      expect(cell.row).toBe(Math.floor(index / GRID_COLS));
    });
  });

  it("reports no board in play as the resting board", () => {
    expect(fromCoreBoard(EMPTY_BOARD)).toEqual({
      cols: 0,
      rows: 0,
      cells: [],
    });
    expect(toCoreBoard({ cols: 0, rows: 0, cells: [] })).toEqual(EMPTY_BOARD);
  });
});

describe("the whole state", () => {
  it("round-trips a title screen unchanged", () => {
    const core = createInitialState();
    expect(toCore(fromCore(core))).toEqual(core);
  });

  it("round-trips a round in progress unchanged", () => {
    const core = busy();
    expect(core.phase).toBe("swapping");
    expect(toCore(fromCore(core))).toEqual(core);
  });

  it("folds the refusal and its timer into one declared field", () => {
    const refused = {
      ...createInitialState(),
      refusal: { a: { col: 1, row: 2 }, b: { col: 1, row: 3 } },
      refusalTimer: 0.12,
    };
    const declared = fromCore(refused);
    expect(declared.refusal).toEqual({
      a: { col: 1, row: 2 },
      b: { col: 1, row: 3 },
      timer: 0.12,
    });
    expect(toCore(declared)).toEqual(refused);
  });

  it("rests the refusal timer at zero while no refusal stands", () => {
    const declared = fromCore(createInitialState());
    expect(declared.refusal).toBeNull();
    expect(toCore(declared).refusalTimer).toBe(0);
  });

  it("carries the one field the rules need past the declaration", () => {
    const declared = fromCore(busy());
    expect(declared.chainSwap).toEqual({
      a: { col: 3, row: 1 },
      b: { col: 3, row: 2 },
    });
  });

  it("carries the rows a gem fell, which is what times the fall", () => {
    const dealt = startRound(createInitialState());
    const declared = fromCore(dealt);
    // Every gem of an opening board came in from above its own row.
    declared.board.cells.forEach((cell) => {
      expect(cell.fell).toBeGreaterThanOrEqual(cell.row + 1);
    });
    expect(toCore(declared)).toEqual(dealt);
  });

  it("carries the offer, the armed target, and the pointer's device", () => {
    const core: CoreState = {
      ...createInitialState(),
      selection: { col: 2, row: 2 },
      offer: { col: 2, row: 3 },
      armedTarget: "menu-1",
      pointer: { x: 12, y: 34, down: true, device: "touch" },
    };
    const declared = fromCore(core);
    expect(declared.offer).toEqual({ col: 2, row: 3 });
    expect(declared.armedTarget).toBe("menu-1");
    expect(declared.pointer.device).toBe("touch");
    expect(toCore(declared)).toEqual(core);
  });

  it("copies the cells rather than sharing them with the core's board", () => {
    const core = busy();
    const declared = fromCore(core);
    expect(declared.board.cells[0]).not.toBe(core.board.gems[0]);
    expect(toCore(declared).board.gems[0]).not.toBe(core.board.gems[0]);
  });
});
