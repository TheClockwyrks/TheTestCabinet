// The board: where a cell sits, what the pointer targets, and the notation.

import { describe, expect, it } from "vitest";
import { CELL_PITCH, GEM_HIT_R } from "../constants";
import {
  cellCenter,
  cellX,
  cellY,
  cellsOf,
  formatBoard,
  formatToken,
  gemAt,
  inBounds,
  isFlawed,
  orthogonalNeighbors,
  orthogonallyAdjacent,
  parseBoard,
  parseToken,
  plainGem,
  sameCell,
  surroundingCells,
  targetCell,
  withGem,
} from "./board";
import { quietRows, quietRowsWith } from "./fixtures";

/** The board the specification writes out under `## Notation`. */
const SPEC_ROWS = [
  "R0 A0 C0 J0 B0 S0 M0 R0",
  "C0 J1 B0 S0 M0 R0 A0 C0",
  "B0 S0 M2 R1 A0 C0 J0 B0",
  "M0 R0 A0 C0 J0 B0b S0 M0",
  "A0 C0 J0 B0 S1 M0 R3 A0",
  "J0 B0 S2s M0 R0 A0 C0 J0",
  "S0 M0 R0 A0 X0 J0 B0 S0",
  "R0 A0 C0 J0 B0 S0 M0 R0",
];

describe("where a cell sits", () => {
  it("runs the cell centers over the extent specs/board.md states", () => {
    expect(cellX(0)).toBe(388);
    expect(cellX(7)).toBe(892);
    expect(cellY(0)).toBe(144);
    expect(cellY(7)).toBe(648);
  });

  it("spaces adjacent centers by CELL_PITCH on both axes", () => {
    expect(cellX(4) - cellX(3)).toBe(CELL_PITCH);
    expect(cellY(4) - cellY(3)).toBe(CELL_PITCH);
  });

  it("reports both axes at once", () => {
    expect(cellCenter({ col: 2, row: 5 })).toEqual([cellX(2), cellY(5)]);
  });
});

describe("cells", () => {
  const board = parseBoard(quietRows());

  it("knows adjacency as R1 states it, orthogonally and not diagonally", () => {
    expect(orthogonallyAdjacent({ col: 3, row: 3 }, { col: 4, row: 3 })).toBe(
      true,
    );
    expect(orthogonallyAdjacent({ col: 3, row: 3 }, { col: 3, row: 2 })).toBe(
      true,
    );
    expect(orthogonallyAdjacent({ col: 3, row: 3 }, { col: 4, row: 4 })).toBe(
      false,
    );
    expect(orthogonallyAdjacent({ col: 3, row: 3 }, { col: 5, row: 3 })).toBe(
      false,
    );
    expect(orthogonallyAdjacent({ col: 3, row: 3 }, { col: 3, row: 3 })).toBe(
      false,
    );
  });

  it("compares cells by address", () => {
    expect(sameCell({ col: 1, row: 2 }, { col: 1, row: 2 })).toBe(true);
    expect(sameCell({ col: 1, row: 2 }, { col: 2, row: 1 })).toBe(false);
  });

  it("holds every cell in reading order", () => {
    const cells = cellsOf(board);
    expect(cells).toHaveLength(64);
    expect(cells[0]).toEqual({ col: 0, row: 0 });
    expect(cells[8]).toEqual({ col: 0, row: 1 });
    expect(cells[63]).toEqual({ col: 7, row: 7 });
  });

  it("reads a gem by address and reports nothing off the board", () => {
    expect(gemAt(board, { col: 0, row: 0 })?.kind).toBe("ruby");
    expect(gemAt(board, { col: -1, row: 0 })).toBeNull();
    expect(gemAt(board, { col: 8, row: 0 })).toBeNull();
    expect(inBounds(board, { col: 7, row: 7 })).toBe(true);
    expect(inBounds(board, { col: 7, row: 8 })).toBe(false);
  });

  it("deals a plain gem at strain 0, with the fall it is given", () => {
    expect(plainGem("ruby")).toEqual({
      kind: "ruby",
      cut: "plain",
      strain: 0,
      fell: 0,
    });
    expect(plainGem("jade", 5).fell).toBe(5);
  });

  it("replaces one cell without touching the board it was handed", () => {
    const written = withGem(board, { col: 3, row: 3 }, plainGem("ruby"));
    expect(gemAt(written, { col: 3, row: 3 })?.kind).toBe("ruby");
    expect(gemAt(board, { col: 3, row: 3 })?.kind).toBe("sapphire");
  });

  it("clips its neighborhoods at the board's edges", () => {
    expect(orthogonalNeighbors(board, { col: 0, row: 0 })).toHaveLength(2);
    expect(orthogonalNeighbors(board, { col: 3, row: 3 })).toHaveLength(4);
    expect(surroundingCells(board, { col: 0, row: 0 })).toHaveLength(3);
    expect(surroundingCells(board, { col: 0, row: 3 })).toHaveLength(5);
    expect(surroundingCells(board, { col: 3, row: 3 })).toHaveLength(8);
  });
});

describe("targeting a cell with the pointer", () => {
  const board = parseBoard(quietRows());

  it("targets the cell a press lands on", () => {
    expect(targetCell(board, cellX(4), cellY(6))).toEqual({ col: 4, row: 6 });
  });

  it("targets nothing farther than GEM_HIT_R from every center", () => {
    expect(targetCell(board, cellX(0), cellY(0) - GEM_HIT_R - 1)).toBeNull();
    expect(targetCell(board, 20, 20)).toBeNull();
  });

  it("settles a tie between two columns on the lower column", () => {
    const between = (cellX(0) + cellX(1)) / 2;
    expect(targetCell(board, between, cellY(0))).toEqual({ col: 0, row: 0 });
  });

  it("settles a tie between two rows on the lower row", () => {
    const between = (cellY(0) + cellY(1)) / 2;
    expect(targetCell(board, cellX(0), between)).toEqual({ col: 0, row: 0 });
  });
});

describe("the fixture boards the tests are posed on", () => {
  it("rewrites the cells it is given", () => {
    const rewritten = quietRowsWith({ "3,4": "R0", "0,0": "X1" });
    expect(rewritten[4].split(" ")[3]).toBe("R0");
    expect(rewritten[0].split(" ")[0]).toBe("X1");
  });

  it("refuses a cell that is not on the board", () => {
    expect(() => quietRowsWith({ "8,0": "R0" })).toThrow();
    expect(() => quietRowsWith({ "x,0": "R0" })).toThrow();
  });
});

describe("the notation", () => {
  it("gives every gem it reads a fell of 0, since a written gem is still", () => {
    expect(parseToken("R0").fell).toBe(0);
    expect(parseToken("S1b").fell).toBe(0);
    expect(parseBoard(SPEC_ROWS).gems.every((gem) => gem?.fell === 0)).toBe(
      true,
    );
  });

  it("reads every token shape the specification names", () => {
    expect(parseToken("R0")).toEqual({
      kind: "ruby",
      cut: "plain",
      strain: 0,
      fell: 0,
    });
    expect(parseToken("J3")).toEqual({
      kind: "jade",
      cut: "plain",
      strain: 3,
      fell: 0,
    });
    expect(parseToken("S1b")).toEqual({
      kind: "sapphire",
      cut: "brilliant",
      strain: 1,
      fell: 0,
    });
    expect(parseToken("C0s")).toEqual({
      kind: "citrine",
      cut: "star",
      strain: 0,
      fell: 0,
    });
    expect(parseToken("X0")).toEqual({
      kind: null,
      cut: "prism",
      strain: 0,
      fell: 0,
    });
    expect(parseToken("X2")).toEqual({
      kind: null,
      cut: "prism",
      strain: 2,
      fell: 0,
    });
  });

  it("maps every kind letter to its kind, in the order of GEM_KINDS", () => {
    const letters = ["R", "A", "C", "J", "B", "S", "M"];
    expect(letters.map((letter) => parseToken(`${letter}0`).kind)).toEqual([
      "ruby",
      "amber",
      "citrine",
      "jade",
      "beryl",
      "sapphire",
      "amethyst",
    ]);
  });

  it("refuses what is not a token", () => {
    expect(() => parseToken("")).toThrow();
    expect(() => parseToken("R")).toThrow();
    expect(() => parseToken("R4")).toThrow();
    expect(() => parseToken("Z0")).toThrow();
    expect(() => parseToken("R0x")).toThrow();
    expect(() => parseToken("r0")).toThrow();
  });

  it("refuses to give a prism a second cut", () => {
    expect(() => parseToken("X0b")).toThrow(/second cut/);
    expect(() => parseToken("X0s")).toThrow(/second cut/);
  });

  it("writes every gem back as the token that reads it", () => {
    for (const token of ["R0", "J3", "S1b", "C0s", "X0", "X3", "M2"]) {
      expect(formatToken(parseToken(token))).toBe(token);
    }
  });

  it("refuses to write a cut that should carry a kind and has none", () => {
    expect(() =>
      formatToken({ kind: null, cut: "brilliant", strain: 0, fell: 0 }),
    ).toThrow(/carries a kind/);
  });

  it("round-trips the board the specification writes out", () => {
    expect(formatBoard(parseBoard(SPEC_ROWS))).toEqual(SPEC_ROWS);
  });

  it("reads the specification's board cell by cell", () => {
    const board = parseBoard(SPEC_ROWS);
    expect(gemAt(board, { col: 1, row: 1 })).toEqual({
      kind: "jade",
      cut: "plain",
      strain: 1,
      fell: 0,
    });
    expect(gemAt(board, { col: 5, row: 3 })).toEqual({
      kind: "beryl",
      cut: "brilliant",
      strain: 0,
      fell: 0,
    });
    expect(gemAt(board, { col: 2, row: 5 })).toEqual({
      kind: "sapphire",
      cut: "star",
      strain: 2,
      fell: 0,
    });
    expect(gemAt(board, { col: 4, row: 6 })).toEqual({
      kind: null,
      cut: "prism",
      strain: 0,
      fell: 0,
    });
    expect(isFlawed(gemAt(board, { col: 6, row: 4 })!)).toBe(true);
    expect(isFlawed(gemAt(board, { col: 0, row: 0 })!)).toBe(false);
  });

  it("refuses a board of the wrong shape", () => {
    expect(() => parseBoard(SPEC_ROWS.slice(0, 7))).toThrow(/8 rows/);
    expect(() => parseBoard([...SPEC_ROWS.slice(0, 7), "R0 A0 C0"])).toThrow(
      /carries 3 cells/,
    );
  });

  it("has no token for an empty cell", () => {
    const board = withGem(parseBoard(SPEC_ROWS), { col: 2, row: 2 }, null);
    expect(() => formatBoard(board)).toThrow(/is empty/);
  });
});
