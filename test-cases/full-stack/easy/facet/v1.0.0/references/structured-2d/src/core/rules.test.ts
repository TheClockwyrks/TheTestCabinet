// R1 to R9, each read against a board posed to isolate it.
//
// Almost every board here is the quiet board of `fixtures.ts` with a few cells
// rewritten, so the run, the cut, or the flaw under test is the only thing on
// the board that the rules can find.

import { describe, expect, it } from "vitest";
import { BASE_SCORE, FLAWED_SCORE, GEM_KINDS, MAX_STRAIN } from "../constants";
import { formatBoard, gemAt, parseBoard, withGem } from "./board";
import { quietRows, quietRowsWith } from "./fixtures";
import { randomPicker } from "./random";
import { NO_REFILL } from "./state";
import {
  applySwap,
  applyStrain,
  cellKey,
  cellsIn,
  creationsFor,
  expandClearSet,
  judgeSwap,
  lastFall,
  legalSwapExists,
  legalSwaps,
  maximalRuns,
  placeCreations,
  placementFor,
  prismSeed,
  productiveSwap,
  removeCells,
  scoreClearSet,
  seedFromRuns,
  posedRefill,
  settleAndRefill,
  type Run,
} from "./rules";
import type { Cell } from "./state";

const board = (edits: Readonly<Record<string, string>> = {}) =>
  parseBoard(quietRowsWith(edits));

const keys = (cells: Iterable<Cell>) => [...cells].map(cellKey).sort();

const setOf = (...cells: Cell[]) => new Set(cells.map(cellKey));

/** A refill that draws every cell, as R9 states for a column with no pose. */
const drawn = posedRefill(NO_REFILL, randomPicker);

describe("R4 runs", () => {
  it("finds nothing on a board with no three in a line", () => {
    expect(maximalRuns(board())).toEqual([]);
  });

  it("finds a row run, indexed from its lowest-column end", () => {
    const runs = maximalRuns(board({ "3,4": "R0", "4,4": "R0" }));
    expect(runs).toHaveLength(1);
    expect(runs[0].orientation).toBe("row");
    expect(runs[0].kind).toBe("ruby");
    expect(runs[0].cells).toEqual([
      { col: 2, row: 4 },
      { col: 3, row: 4 },
      { col: 4, row: 4 },
    ]);
  });

  it("finds a column run, indexed from its lowest-row end", () => {
    const runs = maximalRuns(board({ "2,3": "R0", "2,5": "R0" }));
    expect(runs).toHaveLength(1);
    expect(runs[0].orientation).toBe("column");
    expect(runs[0].cells).toEqual([
      { col: 2, row: 3 },
      { col: 2, row: 4 },
      { col: 2, row: 5 },
    ]);
  });

  it("counts four in a line as one maximal run, not two of three", () => {
    const runs = maximalRuns(board({ "1,4": "R0", "3,4": "R0", "4,4": "R0" }));
    expect(runs).toHaveLength(1);
    expect(runs[0].cells).toHaveLength(4);
  });

  it("takes a whole row when a whole row is one kind", () => {
    const wholeRow = Object.fromEntries(
      Array.from({ length: 8 }, (_, col) => [`${col},4`, "R0"]),
    );
    const runs = maximalRuns(board(wholeRow));
    expect(runs).toHaveLength(1);
    expect(runs[0].cells).toHaveLength(8);
  });

  it("does not count two in a line", () => {
    expect(maximalRuns(board({ "3,4": "R0" }))).toEqual([]);
  });

  it("lets no prism join a run, whatever sits either side of it", () => {
    expect(
      maximalRuns(board({ "1,4": "R0", "3,4": "X0", "4,4": "R0" })),
    ).toEqual([]);
    expect(
      maximalRuns(board({ "2,4": "X0", "3,4": "X0", "4,4": "X0" })),
    ).toEqual([]);
  });

  it("reads a run whatever cuts and strains its gems carry", () => {
    const runs = maximalRuns(board({ "3,4": "R3b", "4,4": "R1s" }));
    expect(runs).toHaveLength(1);
    expect(runs[0].cells).toHaveLength(3);
  });
});

describe("R5 seeding", () => {
  it("seeds with the union of every maximal run", () => {
    // A row run of three crossing a column run of three at (4, 4).
    const posed = board({
      "3,4": "R0",
      "5,4": "R0",
      "4,5": "R0",
      "4,6": "R0",
    });
    const seeded = seedFromRuns(
      applySwap(posed, {
        a: { col: 5, row: 4 },
        b: { col: 4, row: 4 },
      }),
    );
    expect(seeded.runs).toHaveLength(2);
    expect(seeded.cells.size).toBe(5);
  });

  it("seeds nothing on a settled board", () => {
    expect(seedFromRuns(board()).cells.size).toBe(0);
  });

  it("takes no prism seed from a swap that traded no prism", () => {
    const swap = { a: { col: 3, row: 4 }, b: { col: 4, row: 4 } };
    expect(prismSeed(board(), swap)).toBeNull();
  });

  it("seeds a prism traded against a gem with the prism and that kind", () => {
    const swap = { a: { col: 3, row: 4 }, b: { col: 4, row: 4 } };
    // (4, 4) is a citrine on the quiet board, and eight more stand elsewhere.
    const traded = applySwap(board({ "3,4": "X0" }), swap);
    const seeded = prismSeed(traded, swap);
    expect(seeded).not.toBeNull();
    expect(seeded!.runs).toEqual([]);
    // Nine citrines, one of which has moved to (3, 4), plus the prism itself.
    expect(seeded!.cells.size).toBe(10);
    expect(seeded!.cells.has(cellKey({ col: 4, row: 4 }))).toBe(true);
    expect(seeded!.cells.has(cellKey({ col: 3, row: 4 }))).toBe(true);
  });

  it("seeds the same however the two cells of the swap are named", () => {
    const swap = { a: { col: 4, row: 4 }, b: { col: 3, row: 4 } };
    const traded = applySwap(board({ "3,4": "X0" }), swap);
    const seeded = prismSeed(traded, swap);
    expect(seeded!.cells.size).toBe(10);
    expect(seeded!.cells.has(cellKey({ col: 4, row: 4 }))).toBe(true);
  });

  it("takes no seed from a swap naming a cell that holds nothing", () => {
    const emptied = withGem(board({ "3,4": "X0" }), { col: 4, row: 4 }, null);
    expect(
      prismSeed(emptied, {
        a: { col: 3, row: 4 },
        b: { col: 4, row: 4 },
      }),
    ).toBeNull();
  });

  it("seeds a prism traded against a prism with every cell", () => {
    const swap = { a: { col: 3, row: 4 }, b: { col: 4, row: 4 } };
    const traded = applySwap(board({ "3,4": "X0", "4,4": "X1" }), swap);
    const seeded = prismSeed(traded, swap);
    expect(seeded!.cells.size).toBe(64);
    expect(seeded!.runs).toEqual([]);
  });
});

describe("R6 expansion", () => {
  it("leaves a seed of plain gems exactly as it found it", () => {
    const posed = board();
    const seed = setOf({ col: 2, row: 4 }, { col: 3, row: 4 });
    expect(expandClearSet(posed, seed).cells.size).toBe(2);
  });

  it("adds the eight cells around a brilliant in the set", () => {
    const posed = board({ "3,3": "R0b" });
    const cleared = expandClearSet(posed, setOf({ col: 3, row: 3 })).cells;
    expect(cleared.size).toBe(9);
    expect(cleared.has(cellKey({ col: 2, row: 2 }))).toBe(true);
    expect(cleared.has(cellKey({ col: 4, row: 4 }))).toBe(true);
  });

  it("clips a brilliant's ring at the board's edge", () => {
    const posed = board({ "0,0": "R0b" });
    const cleared = expandClearSet(posed, setOf({ col: 0, row: 0 })).cells;
    expect(keys(cellsIn(posed, cleared))).toEqual(
      keys([
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 0, row: 1 },
        { col: 1, row: 1 },
      ]),
    );
  });

  it("adds a star's whole row and column", () => {
    const posed = board({ "3,3": "R0s" });
    const cleared = expandClearSet(posed, setOf({ col: 3, row: 3 })).cells;
    expect(cleared.size).toBe(15);
    expect(cleared.has(cellKey({ col: 0, row: 3 }))).toBe(true);
    expect(cleared.has(cellKey({ col: 3, row: 7 }))).toBe(true);
    expect(cleared.has(cellKey({ col: 0, row: 0 }))).toBe(false);
  });

  it("adds a flawed gem beside the set, and travels on through more", () => {
    const posed = board({ "3,4": "J3", "4,4": "B3", "5,4": "S3" });
    const cleared = expandClearSet(posed, setOf({ col: 2, row: 4 })).cells;
    expect(keys(cellsIn(posed, cleared))).toEqual(
      keys([
        { col: 2, row: 4 },
        { col: 3, row: 4 },
        { col: 4, row: 4 },
        { col: 5, row: 4 },
      ]),
    );
  });

  it("ignores a seed cell that is not on the board at all", () => {
    const posed = board();
    const seed = setOf({ col: 2, row: 4 }, { col: 99, row: 99 });
    expect(expandClearSet(posed, seed).cells.size).toBe(2);
  });

  it("does not reach a flawed gem that is only diagonally beside the set", () => {
    const posed = board({ "3,5": "B3" });
    expect(expandClearSet(posed, setOf({ col: 2, row: 4 })).cells.size).toBe(1);
  });

  it("closes over a brilliant reached through a flawed gem", () => {
    const posed = board({ "3,4": "J3", "4,4": "B0b" });
    const cleared = expandClearSet(posed, setOf({ col: 2, row: 4 })).cells;
    // The flawed jade joins, its brilliant neighbor is not flawed and does
    // not, so the ring is not opened: the set is the seed and the flaw.
    expect(cleared.size).toBe(2);

    const withFlawedBrilliant = board({ "3,4": "J3", "4,4": "B3b" });
    const opened = expandClearSet(
      withFlawedBrilliant,
      setOf({ col: 2, row: 4 }),
    ).cells;
    expect(opened.has(cellKey({ col: 5, row: 5 }))).toBe(true);
    expect(opened.size).toBe(10);
  });
});

describe("R6 waves", () => {
  it("gives a set that is its seed alone no wave beyond 0", () => {
    const seeded = expandClearSet(
      board(),
      setOf({ col: 2, row: 4 }, { col: 3, row: 4 }),
    );
    expect(seeded.waves).toBe(0);
    expect(seeded.waveOf.get(cellKey({ col: 2, row: 4 }))).toBe(0);
  });

  it("puts a cell an addition brings in one wave behind the cell that did", () => {
    const posed = board({ "3,3": "R0b" });
    const expanded = expandClearSet(posed, setOf({ col: 3, row: 3 }));
    expect(expanded.waves).toBe(1);
    expect(expanded.waveOf.get(cellKey({ col: 3, row: 3 }))).toBe(0);
    for (const around of [
      { col: 2, row: 2 },
      { col: 4, row: 4 },
      { col: 3, row: 2 },
    ]) {
      expect(expanded.waveOf.get(cellKey(around))).toBe(1);
    }
  });

  it("counts a wave per addition down a chain of flawed gems", () => {
    const posed = board({ "3,4": "J3", "4,4": "B3", "5,4": "S3" });
    const expanded = expandClearSet(posed, setOf({ col: 2, row: 4 }));
    expect(expanded.waves).toBe(3);
    expect(expanded.waveOf.get(cellKey({ col: 3, row: 4 }))).toBe(1);
    expect(expanded.waveOf.get(cellKey({ col: 4, row: 4 }))).toBe(2);
    expect(expanded.waveOf.get(cellKey({ col: 5, row: 4 }))).toBe(3);
  });

  it("takes the lowest wave any addition reaches a cell at", () => {
    // (4, 4) lies in the star's row and is also one of the ring around the
    // brilliant, and both reach it from a seed cell, so it is at wave 1
    // whichever addition got there first.
    const posed = board({ "3,4": "R0s", "3,3": "R0b" });
    const expanded = expandClearSet(
      posed,
      setOf({ col: 3, row: 4 }, { col: 3, row: 3 }),
    );
    expect(expanded.waveOf.get(cellKey({ col: 4, row: 4 }))).toBe(1);
    expect(expanded.waveOf.get(cellKey({ col: 4, row: 3 }))).toBe(1);
  });

  it("changes nothing about which cells the set holds", () => {
    const posed = board({ "3,4": "J3", "4,4": "B3", "5,4": "S3" });
    const expanded = expandClearSet(posed, setOf({ col: 2, row: 4 }));
    expect(expanded.cells.size).toBe(4);
    expect([...expanded.waveOf.keys()].sort()).toEqual(
      [...expanded.cells].sort(),
    );
  });
});

describe("R7 strain", () => {
  const cleared = setOf(
    { col: 2, row: 4 },
    { col: 3, row: 4 },
    { col: 4, row: 4 },
  );

  it("raises every orthogonal survivor by one, and nothing else", () => {
    const strained = applyStrain(board(), cleared);
    expect(gemAt(strained.board, { col: 1, row: 4 })?.strain).toBe(1);
    expect(gemAt(strained.board, { col: 5, row: 4 })?.strain).toBe(1);
    expect(gemAt(strained.board, { col: 3, row: 3 })?.strain).toBe(1);
    expect(gemAt(strained.board, { col: 3, row: 5 })?.strain).toBe(1);
    // Diagonal, and two cells away, are both untouched.
    expect(gemAt(strained.board, { col: 5, row: 5 })?.strain).toBe(0);
    expect(gemAt(strained.board, { col: 3, row: 2 })?.strain).toBe(0);
    // A cell inside the clear set is not strained; it is about to go.
    expect(gemAt(strained.board, { col: 3, row: 4 })?.strain).toBe(0);
  });

  it("raises a gem once however many cleared neighbors it has", () => {
    // (3, 5) is beside both (3, 4) and (4, 5) in this L-shaped set.
    const lShaped = setOf(
      { col: 3, row: 4 },
      { col: 4, row: 4 },
      { col: 4, row: 5 },
    );
    const strained = applyStrain(board({ "3,5": "B1" }), lShaped);
    expect(gemAt(strained.board, { col: 3, row: 5 })?.strain).toBe(2);
  });

  it("caps a gem at MAX_STRAIN", () => {
    const strained = applyStrain(board({ "1,4": "M2", "5,4": "J3" }), cleared);
    expect(gemAt(strained.board, { col: 1, row: 4 })?.strain).toBe(MAX_STRAIN);
    expect(gemAt(strained.board, { col: 5, row: 4 })?.strain).toBe(MAX_STRAIN);
  });

  it("counts only the gems the step left newly flawed", () => {
    expect(applyStrain(board(), cleared).flawed).toBe(0);
    expect(applyStrain(board({ "1,4": "M2" }), cleared).flawed).toBe(1);
    expect(
      applyStrain(board({ "1,4": "M2", "5,4": "J2" }), cleared).flawed,
    ).toBe(2);
    // Already flawed, so nothing new: R6 would have taken it anyway.
    expect(applyStrain(board({ "1,4": "M3" }), cleared).flawed).toBe(0);
  });
});

describe("scoring a clear set", () => {
  const cleared = setOf(
    { col: 2, row: 4 },
    { col: 3, row: 4 },
    { col: 4, row: 4 },
  );

  it("pays BASE_SCORE for a gem below MAX_STRAIN, times the multiplier", () => {
    expect(scoreClearSet(board({ "3,4": "R2" }), cleared, 1)).toBe(
      3 * BASE_SCORE,
    );
    expect(scoreClearSet(board(), cleared, 4)).toBe(3 * BASE_SCORE * 4);
  });

  it("pays nothing for a cell of the set that holds no gem", () => {
    const emptied = withGem(board(), { col: 3, row: 4 }, null);
    expect(scoreClearSet(emptied, cleared, 1)).toBe(2 * BASE_SCORE);
  });

  it("pays FLAWED_SCORE, double, for a gem at MAX_STRAIN", () => {
    expect(scoreClearSet(board({ "3,4": "R3" }), cleared, 1)).toBe(
      2 * BASE_SCORE + FLAWED_SCORE,
    );
    expect(FLAWED_SCORE).toBe(2 * BASE_SCORE);
  });
});

describe("removal", () => {
  it("empties exactly the clear set", () => {
    const posed = board();
    const emptied = removeCells(
      posed,
      setOf({ col: 2, row: 4 }, { col: 3, row: 4 }),
    );
    expect(gemAt(emptied, { col: 2, row: 4 })).toBeNull();
    expect(gemAt(emptied, { col: 3, row: 4 })).toBeNull();
    expect(gemAt(emptied, { col: 4, row: 4 })).not.toBeNull();
  });
});

describe("R8 cuts", () => {
  const rowCells = (cols: number[], row: number) =>
    cols.map((col) => ({ col, row }));

  const rowRun = (cols: number[], row: number): Run => ({
    kind: "ruby",
    orientation: "row",
    cells: rowCells(cols, row),
  });

  const columnRun = (col: number, rows: number[]): Run => ({
    kind: "ruby",
    orientation: "column",
    cells: rows.map((row) => ({ col, row })),
  });

  it("creates nothing from a run of exactly three", () => {
    expect(creationsFor([rowRun([2, 3, 4], 4)], null)).toEqual([]);
  });

  it("creates a brilliant from a run of exactly four", () => {
    const created = creationsFor([rowRun([1, 2, 3, 4], 4)], {
      a: { col: 3, row: 4 },
      b: { col: 3, row: 5 },
    });
    expect(created).toEqual([
      {
        cell: { col: 3, row: 4 },
        gem: { kind: "ruby", cut: "brilliant", strain: 0, fell: 0 },
      },
    ]);
  });

  it("creates a prism, which carries no kind, from a run of five or more", () => {
    const created = creationsFor([rowRun([2, 3, 4, 5, 6], 4)], {
      a: { col: 4, row: 5 },
      b: { col: 4, row: 4 },
    });
    expect(created).toEqual([
      {
        cell: { col: 4, row: 4 },
        gem: { kind: null, cut: "prism", strain: 0, fell: 0 },
      },
    ]);
  });

  it("creates a star where a row run and a column run cross", () => {
    const created = creationsFor(
      [rowRun([2, 3, 4], 4), columnRun(4, [4, 5, 6])],
      { a: { col: 5, row: 4 }, b: { col: 4, row: 4 } },
    );
    expect(created).toEqual([
      {
        cell: { col: 4, row: 4 },
        gem: { kind: "ruby", cut: "star", strain: 0, fell: 0 },
      },
    ]);
  });

  it("gives one cell one gem, star over brilliant", () => {
    const created = creationsFor(
      [rowRun([1, 2, 3, 4], 4), columnRun(3, [3, 4, 5])],
      { a: { col: 3, row: 4 }, b: { col: 3, row: 6 } },
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      cell: { col: 3, row: 4 },
      gem: { kind: "ruby", cut: "star", strain: 0, fell: 0 },
    });
  });

  it("gives one cell one gem, prism over star", () => {
    const created = creationsFor(
      [rowRun([0, 1, 2, 3, 4], 4), columnRun(3, [3, 4, 5])],
      { a: { col: 3, row: 4 }, b: { col: 3, row: 6 } },
    );
    expect(created).toHaveLength(1);
    expect(created[0].gem.cut).toBe("prism");
  });

  it("creates two gems when the two rows land on two cells", () => {
    const created = creationsFor(
      [rowRun([1, 2, 3, 4], 4), columnRun(1, [3, 4, 5])],
      { a: { col: 4, row: 4 }, b: { col: 4, row: 5 } },
    );
    expect(created).toHaveLength(2);
    expect(created.map((one) => [one.cell, one.gem.cut])).toEqual([
      [{ col: 4, row: 4 }, "brilliant"],
      [{ col: 1, row: 4 }, "star"],
    ]);
  });

  it("places a created gem at the swapped cell that lies in the run", () => {
    const run = rowRun([1, 2, 3, 4], 4);
    expect(
      placementFor(run, { a: { col: 3, row: 5 }, b: { col: 3, row: 4 } }),
    ).toEqual({ col: 3, row: 4 });
  });

  it("places it at the lower index when both swapped cells lie in the run", () => {
    const run = rowRun([1, 2, 3, 4], 4);
    expect(
      placementFor(run, { a: { col: 3, row: 4 }, b: { col: 2, row: 4 } }),
    ).toEqual({ col: 2, row: 4 });
  });

  it("places it at floor((n - 1) / 2) when neither swapped cell lies in it", () => {
    const swap = { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } };
    expect(placementFor(rowRun([2, 3, 4], 4), swap)).toEqual({
      col: 3,
      row: 4,
    });
    expect(placementFor(rowRun([1, 2, 3, 4], 4), swap)).toEqual({
      col: 2,
      row: 4,
    });
    expect(placementFor(rowRun([2, 3, 4, 5, 6], 4), swap)).toEqual({
      col: 4,
      row: 4,
    });
    expect(placementFor(columnRun(3, [1, 2, 3, 4]), swap)).toEqual({
      col: 3,
      row: 2,
    });
  });

  it("creates nothing at all from a step that had no runs to read", () => {
    expect(
      creationsFor([], { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } }),
    ).toEqual([]);
  });

  it("places the created gems into the cells the removal emptied", () => {
    const emptied = removeCells(board(), setOf({ col: 3, row: 4 }));
    const placed = placeCreations(emptied, [
      {
        cell: { col: 3, row: 4 },
        gem: { kind: "ruby", cut: "brilliant", strain: 0, fell: 0 },
      },
    ]);
    expect(gemAt(placed, { col: 3, row: 4 })).toEqual({
      kind: "ruby",
      cut: "brilliant",
      strain: 0,
      fell: 0,
    });
  });
});

describe("R9 settling", () => {
  it("drops the survivors, carrying strain and cut, and refills the top", () => {
    const posed = board({ "2,3": "B2b" });
    const emptied = removeCells(
      posed,
      setOf({ col: 2, row: 4 }, { col: 2, row: 5 }),
    );
    const settled = settleAndRefill(emptied, drawn);

    // The column held C S A B(2, brilliant) R J M C; two cells went, so the
    // six survivors sit at rows 2..7 in the order they stood in.
    expect(gemAt(settled, { col: 2, row: 5 })).toEqual({
      kind: "beryl",
      cut: "brilliant",
      strain: 2,
      fell: 2,
    });
    expect(gemAt(settled, { col: 2, row: 2 })?.kind).toBe("citrine");
    expect(gemAt(settled, { col: 2, row: 7 })?.kind).toBe("citrine");

    // The two cells refilled from the top carry a plain gem at strain 0.
    for (const row of [0, 1]) {
      const fresh = gemAt(settled, { col: 2, row });
      expect(fresh?.cut).toBe("plain");
      expect(fresh?.strain).toBe(0);
      expect(fresh?.kind).not.toBeNull();
    }
  });

  it("gives every gem the rows it traveled, and nothing to one that stood", () => {
    const emptied = removeCells(
      board(),
      setOf({ col: 2, row: 4 }, { col: 2, row: 5 }),
    );
    const settled = settleAndRefill(emptied, drawn);
    // Two cells went from column 2, so its four survivors above them each
    // dropped two rows and the two below them did not move at all.
    for (const row of [2, 3, 4, 5]) {
      expect(gemAt(settled, { col: 2, row })?.fell).toBe(2);
    }
    expect(gemAt(settled, { col: 2, row: 6 })?.fell).toBe(0);
    expect(gemAt(settled, { col: 2, row: 7 })?.fell).toBe(0);
    // A refilled gem comes from above the top row, so row `r` is `r + 1`.
    expect(gemAt(settled, { col: 2, row: 0 })?.fell).toBe(1);
    expect(gemAt(settled, { col: 2, row: 1 })?.fell).toBe(2);
    // Every column the step did not touch is left standing still.
    for (const col of [0, 1, 3, 4, 5, 6, 7]) {
      for (let row = 0; row < 8; row++) {
        expect(gemAt(settled, { col, row })?.fell).toBe(0);
      }
    }
  });

  it("gives a wholly emptied column one row of travel per row of gap", () => {
    const column = new Set(
      Array.from({ length: 8 }, (_v, row) => cellKey({ col: 5, row })),
    );
    const settled = settleAndRefill(removeCells(board(), column), drawn);
    for (let row = 0; row < 8; row++) {
      expect(gemAt(settled, { col: 5, row })?.fell).toBe(row + 1);
    }
  });

  it("reads the longest fall on the board back off the gems", () => {
    expect(lastFall(board())).toBe(0);
    const emptied = removeCells(
      board(),
      setOf({ col: 2, row: 4 }, { col: 2, row: 5 }),
    );
    expect(lastFall(settleAndRefill(emptied, drawn))).toBe(2);
    const column = new Set(
      Array.from({ length: 8 }, (_v, row) => cellKey({ col: 5, row })),
    );
    const emptyColumn = removeCells(board(), column);
    expect(lastFall(settleAndRefill(emptyColumn, drawn))).toBe(8);
  });

  it("leaves every other column exactly as it was", () => {
    const posed = board();
    const emptied = removeCells(posed, setOf({ col: 2, row: 4 }));
    const settled = settleAndRefill(emptied, drawn);
    for (const col of [0, 1, 3, 4, 5, 6, 7]) {
      for (let row = 0; row < 8; row++) {
        expect(gemAt(settled, { col, row })).toEqual(
          gemAt(posed, { col, row }),
        );
      }
    }
  });

  it("fills a wholly emptied column with eight fresh gems", () => {
    const column = new Set(
      Array.from({ length: 8 }, (_, row) => cellKey({ col: 5, row })),
    );
    const settled = settleAndRefill(removeCells(board(), column), drawn);
    expect(formatBoard(settled)).toHaveLength(8);
    for (let row = 0; row < 8; row++) {
      expect(gemAt(settled, { col: 5, row })?.strain).toBe(0);
      expect(gemAt(settled, { col: 5, row })?.cut).toBe("plain");
    }
  });

  it("deals the posed kind into a posed column, and draws elsewhere", () => {
    const refill = posedRefill(["", "", "SJ", "", "", "", "", ""], {
      pick: <T>(items: readonly T[]): T => items[0],
    });
    const emptied = removeCells(
      board(),
      setOf({ col: 2, row: 4 }, { col: 2, row: 5 }, { col: 3, row: 4 }),
    );
    const settled = settleAndRefill(emptied, refill);
    expect(gemAt(settled, { col: 2, row: 0 })?.kind).toBe("sapphire");
    expect(gemAt(settled, { col: 2, row: 1 })?.kind).toBe("jade");
    // Column 3 has no pose, so its refill is the picker's draw.
    expect(gemAt(settled, { col: 3, row: 0 })?.kind).toBe(GEM_KINDS[0]);
  });

  it("draws a row past the end of a column's pose", () => {
    const refill = posedRefill(["", "", "S", "", "", "", "", ""], {
      pick: <T>(items: readonly T[]): T => items[items.length - 1],
    });
    const emptied = removeCells(
      board(),
      setOf({ col: 2, row: 4 }, { col: 2, row: 5 }),
    );
    const settled = settleAndRefill(emptied, refill);
    expect(gemAt(settled, { col: 2, row: 0 })?.kind).toBe("sapphire");
    expect(gemAt(settled, { col: 2, row: 1 })?.kind).toBe(
      GEM_KINDS[GEM_KINDS.length - 1],
    );
  });
});

describe("R1, R2 and R3, the move rules", () => {
  const posed = board({ "3,5": "R0", "4,4": "R0" });
  const productive = { a: { col: 3, row: 5 }, b: { col: 3, row: 4 } };

  it("accepts an adjacent, productive swap on a settled board", () => {
    expect(judgeSwap(posed, "idle", productive)).toBe("accepted");
  });

  it("refuses a swap of cells that are not orthogonally adjacent", () => {
    expect(
      judgeSwap(posed, "idle", {
        a: { col: 3, row: 5 },
        b: { col: 4, row: 4 },
      }),
    ).toBe("adjacency");
    expect(
      judgeSwap(posed, "idle", {
        a: { col: 3, row: 5 },
        b: { col: 3, row: 5 },
      }),
    ).toBe("adjacency");
    expect(
      judgeSwap(posed, "idle", {
        a: { col: 0, row: 0 },
        b: { col: -1, row: 0 },
      }),
    ).toBe("adjacency");
  });

  it("refuses any swap while the board is still resolving", () => {
    expect(judgeSwap(posed, "resolving", productive)).toBe("resolving");
  });

  it("refuses a swap that would produce no run", () => {
    expect(
      judgeSwap(board(), "idle", {
        a: { col: 3, row: 4 },
        b: { col: 4, row: 4 },
      }),
    ).toBe("barren");
  });

  it("accepts any adjacent swap that trades a prism", () => {
    const withPrism = board({ "3,4": "X0" });
    expect(
      judgeSwap(withPrism, "idle", {
        a: { col: 3, row: 4 },
        b: { col: 4, row: 4 },
      }),
    ).toBe("accepted");
    expect(
      judgeSwap(withPrism, "idle", {
        a: { col: 4, row: 4 },
        b: { col: 3, row: 4 },
      }),
    ).toBe("accepted");
  });

  it("exchanges the two cells at once", () => {
    const swapped = applySwap(posed, productive);
    expect(gemAt(swapped, { col: 3, row: 4 })?.kind).toBe("ruby");
    expect(gemAt(swapped, { col: 3, row: 5 })?.kind).toBe("amber");
    expect(gemAt(posed, { col: 3, row: 4 })?.kind).toBe("amber");
  });

  it("leaves both exchanged gems standing still in their new cells", () => {
    const fallen = settleAndRefill(
      removeCells(board(), setOf({ col: 3, row: 4 })),
      drawn,
    );
    expect(gemAt(fallen, { col: 3, row: 4 })?.fell).toBe(1);
    const swapped = applySwap(fallen, {
      a: { col: 3, row: 4 },
      b: { col: 4, row: 4 },
    });
    expect(gemAt(swapped, { col: 3, row: 4 })?.fell).toBe(0);
    expect(gemAt(swapped, { col: 4, row: 4 })?.fell).toBe(0);
  });

  it("reads productivity off the board rather than off the phase", () => {
    expect(productiveSwap(posed, productive)).toBe(true);
    expect(
      productiveSwap(posed, {
        a: { col: 0, row: 0 },
        b: { col: 1, row: 0 },
      }),
    ).toBe(false);
    expect(
      productiveSwap(posed, {
        a: { col: 0, row: 0 },
        b: { col: 8, row: 0 },
      }),
    ).toBe(false);
  });
});

describe("the legal-swap search", () => {
  it("finds none on the quiet board, which is what ends a round", () => {
    expect(legalSwaps(parseBoard(quietRows()))).toEqual([]);
    expect(legalSwapExists(parseBoard(quietRows()))).toBe(false);
  });

  it("finds the one swap a board has been posed to carry", () => {
    // (1, 4) is an amethyst already; the pose puts a second beside it and a
    // third one cell above, and dropping that third in is the only move.
    const posed = board({ "0,4": "M0", "2,3": "M0" });
    expect(legalSwaps(posed)).toEqual([
      { a: { col: 2, row: 3 }, b: { col: 2, row: 4 } },
    ]);
    expect(legalSwapExists(posed)).toBe(true);
  });

  it("counts a swap that trades a prism as legal wherever it sits", () => {
    const posed = board({ "0,0": "X0" });
    expect(legalSwaps(posed)).toHaveLength(2);
    expect(legalSwapExists(posed)).toBe(true);
  });

  it("consults R1 and R3 but not R2, so it answers to the board alone", () => {
    const posed = board({ "3,3": "R0", "4,4": "R0" });
    expect(legalSwapExists(posed)).toBe(true);
    expect(judgeSwap(posed, "resolving", legalSwaps(posed)[0])).toBe(
      "resolving",
    );
  });

  it("finds nothing on a board with no gems on it at all", () => {
    const empty = withGem(board(), { col: 0, row: 0 }, null);
    expect(legalSwapExists(empty)).toBe(false);
  });
});
