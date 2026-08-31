// Facet — the board notation, its fixtures, its predicates, and its geometry.
// CASE-PROVIDED.
//
// SHARED FILE. Byte-identical in `validation/none/`, `validation/simple-2d/` and
// `validation/structured-2d/`. It is copied between the three rather than
// re-derived: a fixture is an ARGUMENT to a review item, so `deadBoard()` has to
// pose the same world under every engine or `levels/gameover-no-legal-swap` would
// be three different questions wearing one name. An edit belongs in all three
// copies at once; two copies that differ are a defect in the case.
//
// Everything here is PURE. It imports `./constants` and `./assert` and nothing
// else — no engine, no browser, no harness — which is what lets `harness.test.ts`
// drive every function below without standing a build up, and what lets one text
// serve three architectures.
//
// WHY A NOTATION MODULE IS THE CENTER OF THIS SUITE. specs/instrumentation.md
// gives the surface `loadBoard(rows)`, which poses an arbitrary board written in
// the notation specs/board.md fixes, and says a board posed that way is a board
// like any other. So almost every rule in specs/rules.md is decided the same way:
// write the exact board the rule is about, pose it, request the swap, read the
// exact outcome back. This module turns a written board into something a check
// can pose, and a snapshot back into something a check can read.
//
// WHAT IS SPECIFICATION HERE AND WHAT IS THE CASE'S OWN SCENERY.
//
//  - The NOTATION, the CELL-CENTER FORMULAS and the RUN, SWAP and CLEAR-SET
//    predicates are specs/board.md and specs/rules.md written down. They are the
//    case restating the contract, and each one names the rule it is.
//  - The FIXTURES (`quietBoard`, `deadBoard`, `ESCAPE_CELLS`, and the helpers
//    that write cells over them) are the case's own scenery, chosen so a scenario
//    poses exactly one thing and nothing else. `harness.test.ts` proves each
//    fixture really has the property its name claims, against the predicates
//    rather than against the construction that produced it — a fixture that
//    quietly stopped being quiet would turn every check built on it into a lie.
//
// The predicates are never the build's answer to anything. A check that wants to
// know what the BUILD thinks reads `snapshot().legalSwap` and compares it with
// `legalSwapExists`, which is the whole of the `levels/legal-swap-derived` item.

import { fail } from "./assert";
import {
  BOARD_CX,
  BOARD_CY,
  CELL_PITCH,
  CUTS,
  GEM_HIT_R,
  GEM_KINDS,
  GRID_COLS,
  GRID_ROWS,
  MATCH_MIN,
  MAX_STRAIN,
  type Cut,
  type GemKind,
} from "./constants";

/**
 * The two unions have ONE home, in `constants.ts`, which derives them from the
 * literal tables specs/board.md fixes. They are re-exported here because a
 * module reading a board reaches for this file, and two independent declarations
 * of one union drift in silence.
 */
export type { Cut, GemKind };

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** A board written in the notation: `GRID_ROWS` lines of `GRID_COLS` tokens. */
export type BoardRows = readonly string[];

/** One cell of the board, addressed as specs/board.md addresses it. */
export interface CellRef {
  col: number;
  row: number;
}

/** One token to write at one cell, as the fixture helpers take them. */
export interface PlacedToken {
  col: number;
  row: number;
  token: string;
}

/** One gem, as a token names it. A `prism` carries no kind. */
export interface Gem {
  kind: GemKind | null;
  cut: Cut;
  strain: number;
}

/** A maximal run under R4: its cells, the kind they share, and its axis. */
export interface Run {
  cells: CellRef[];
  kind: GemKind;
  horizontal: boolean;
}

/**
 * Only what {@link renderBoard} reads of a snapshot, so this module imports no
 * surface.
 *
 * A `FacetSnapshot` satisfies it structurally under all three engines, whose
 * `surface.ts` otherwise differ. `kind` and `cut` are read as plain strings
 * because they arrive from the BUILD: holding them to the unions here would be
 * asserting in the type system something the build has not yet been shown to
 * honor, so they are checked as values instead.
 */
export interface BoardReading {
  board: {
    cols: number;
    rows: number;
    cells: readonly {
      col: number;
      row: number;
      kind: string | null;
      cut: string;
      strain: number;
    }[];
  };
}

/**
 * The token that matches whatever stands at its cell.
 *
 * R9 refills from the game's own seeded generator, so what lands in a refilled
 * cell is the build's business and no check may assert it. A check about a chain
 * states the cells that SURVIVED and writes this at every cell the refill could
 * have reached.
 */
export const WILDCARD = "..";

/**
 * What {@link renderBoard} writes where the build reported no cell at all.
 *
 * Deliberately not {@link WILDCARD}: a hole in the board a build reports is a
 * fault, and writing the wildcard there would let it pass wherever a check had
 * masked that cell. `??` is a token of no notation, so it matches nothing.
 */
const UNREPORTED = "??";

/* -------------------------------------------------------------------------- */
/* The notation — specs/board.md                                              */
/* -------------------------------------------------------------------------- */

/** The kind letter of each of the seven kinds, in `GEM_KINDS` order. */
const KIND_LETTERS = ["R", "A", "C", "J", "B", "S", "M"] as const;

/** The prism's letter. A prism carries no kind, so this names its cut. */
const PRISM_LETTER = "X";

/**
 * The cut each trailing letter names; `plain` is written with none.
 *
 * Typed as possibly absent because the lookup is fed a letter read out of a
 * fixture, and a letter the table does not name has to be reported as one.
 */
const CUT_LETTERS: Readonly<Record<string, Cut | undefined>> = {
  "": "plain",
  b: "brilliant",
  s: "star",
};

/** The letter each cut is written with. A prism's is carried by its `X`. */
const CUT_SUFFIX: Readonly<Record<Cut, string>> = {
  plain: "",
  brilliant: "b",
  star: "s",
  prism: "",
};

/**
 * The shape of a cell token: a kind letter, a strain digit, an optional cut
 * letter.
 *
 * The digit and the cut letter are captured loosely and held to the
 * specification's range and table below, so `R4` fails as a strain out of range
 * and `R0x` as a cut letter the notation does not name, rather than both failing
 * as "not a token".
 */
const TOKEN = /^([RACJBSMX])([0-9])([a-z]?)$/;

/**
 * The gem a cell token names.
 *
 * Fails the FIXTURE, never the build: a token this cannot read is a typo in a
 * check, and a typo must be reported as a typo rather than traveling into the
 * build and coming back as a verdict about it.
 */
export function parseToken(token: string): Gem {
  const match = TOKEN.exec(token);
  if (match === null) {
    fail(
      `a cell token of specs/board.md's notation: a kind letter ` +
        `(${KIND_LETTERS.join(" ")}, or ${PRISM_LETTER} for a prism), a strain ` +
        `digit 0-${MAX_STRAIN}, then an optional cut letter (b, s)`,
      token,
    );
  }
  const [, letter, digit, suffix] = match;
  const strain = Number(digit);
  if (strain > MAX_STRAIN) {
    fail(`a strain digit 0-${MAX_STRAIN} (token ${token})`, strain);
  }
  if (letter === PRISM_LETTER) {
    if (suffix !== "") {
      fail(
        `no cut letter on a prism, whose ${PRISM_LETTER} names its cut ` +
          `(token ${token})`,
        suffix,
      );
    }
    return { kind: null, cut: "prism", strain };
  }
  const cut = CUT_LETTERS[suffix];
  if (cut === undefined) {
    fail(`a cut letter of b or s (token ${token})`, suffix);
  }
  const index = KIND_LETTERS.indexOf(letter as (typeof KIND_LETTERS)[number]);
  return { kind: GEM_KINDS[index], cut, strain };
}

/**
 * The cell token that names a gem, the inverse of {@link parseToken}.
 *
 * A prism is written by its cut alone, since specs/board.md gives it no kind to
 * write; a gem of any other cut that carries no kind is not a gem the notation
 * can write, and says so.
 */
export function formatToken(gem: Gem): string {
  if (gem.cut === "prism") return `${PRISM_LETTER}${gem.strain}`;
  const index = GEM_KINDS.indexOf(gem.kind as GemKind);
  if (index < 0) {
    fail(
      `a gem carrying one of the seven kinds (${GEM_KINDS.join(", ")}), or a ` +
        `prism, which carries none`,
      gem.kind,
    );
  }
  return `${KIND_LETTERS[index]}${gem.strain}${CUT_SUFFIX[gem.cut]}`;
}

/** The token for a kind, a strain and a cut. `null` kind means a prism. */
export function tokenOf(
  kind: GemKind | null,
  strain: number,
  cut: Cut = "plain",
): string {
  return formatToken({ kind, cut, strain });
}

/** The tokens of one written row. */
function tokensOf(row: string): string[] {
  return row
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "");
}

/**
 * A written board as gems, indexed `[row][col]`.
 *
 * A board that is not `GRID_ROWS` lines of `GRID_COLS` tokens fails here, in the
 * fixture, rather than reaching the build.
 */
export function parseRows(rows: BoardRows): Gem[][] {
  if (rows.length !== GRID_ROWS) {
    fail(`${GRID_ROWS} rows of board notation`, rows.length);
  }
  return rows.map((row, index) => {
    const tokens = tokensOf(row);
    if (tokens.length !== GRID_COLS) {
      fail(`${GRID_COLS} tokens in row ${index}`, row);
    }
    return tokens.map(parseToken);
  });
}

/** Gems indexed `[row][col]`, written back as the notation. */
export function formatRows(cells: readonly (readonly Gem[])[]): string[] {
  return cells.map((row) => row.map(formatToken).join(" "));
}

/** The token standing at `(col, row)` of a written board. */
export function tokenAt(rows: BoardRows, col: number, row: number): string {
  if (row < 0 || row >= rows.length) {
    fail(`a row within 0..${rows.length - 1}`, row);
  }
  const tokens = tokensOf(rows[row]);
  if (col < 0 || col >= tokens.length) {
    fail(`a column within 0..${tokens.length - 1}`, col);
  }
  return tokens[col];
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot back as notation                                        */
/* -------------------------------------------------------------------------- */

/** A kind the build reported, held to the seven specs/board.md names. */
function asKind(value: string | null): GemKind | null {
  if (value === null) return null;
  if ((GEM_KINDS as readonly string[]).includes(value)) return value as GemKind;
  fail(`one of the seven kinds (${GEM_KINDS.join(", ")}), or null`, value);
}

/** A cut the build reported, held to the four specs/board.md names. */
function asCut(value: string): Cut {
  if ((CUTS as readonly string[]).includes(value)) return value as Cut;
  fail(`one of the four cuts (${CUTS.join(", ")})`, value);
}

/** One cell the build reported, as its token. */
function cellToken(cell: BoardReading["board"]["cells"][number]): string {
  return formatToken({
    kind: asKind(cell.kind),
    cut: asCut(cell.cut),
    strain: cell.strain,
  });
}

/**
 * The board a snapshot reports, written in the notation, one string per row.
 *
 * A cell is placed by the `col` and `row` it reports rather than by its position
 * in the list, so what this renders is the board the build says it holds.
 * Whether `cells` is listed in reading order is a separate question, and
 * `instrumentation/debug-api` is where it is asked — which is also where a cell
 * reported outside the board is named, so one is passed over here rather than
 * failing a check that was about something else.
 */
export function renderBoard(snapshot: BoardReading): string[] {
  const { cols, rows, cells } = snapshot.board;
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => UNREPORTED),
  );
  for (const cell of cells) {
    if (cell.col < 0 || cell.col >= cols || cell.row < 0 || cell.row >= rows) {
      continue;
    }
    grid[cell.row][cell.col] = cellToken(cell);
  }
  return grid.map((row) => row.join(" "));
}

/** The token a snapshot reports at one cell. */
export function renderCell(
  snapshot: BoardReading,
  col: number,
  row: number,
): string {
  const cell = snapshot.board.cells.find(
    (candidate) => candidate.col === col && candidate.row === row,
  );
  if (cell === undefined) {
    fail(`a reported cell at (${col},${row})`, "none");
  }
  return cellToken(cell);
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The run-free filler every isolated scenario is posed over.
 *
 * `GEM_KINDS[(col + 2 * row) % 7]`, every gem plain at strain 0. Along a row the
 * kind index advances by one and down a column by two, so three consecutive
 * cells of a row hold `i, i+1, i+2` and of a column `i, i+2, i+4` — all distinct
 * modulo 7. No three consecutive cells anywhere can share a kind, so the filler
 * carries no maximal run under R4, and a scenario written over it decides its
 * point on the cells the scenario placed.
 *
 * It carries NO LEGAL SWAP of its own either, which is the other half of the
 * isolation: the only productive swap on a posed board is the one the scenario
 * put there. That has a consequence a check must know about, and
 * {@link quietRowsWith} states it.
 *
 * `harness.test.ts` proves both properties against {@link maximalRuns} and
 * {@link legalSwapExists} rather than trusting the argument above.
 */
export function quietBoard(): string[] {
  const rows: string[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const tokens: string[] = [];
    for (let col = 0; col < GRID_COLS; col += 1) {
      tokens.push(tokenOf(GEM_KINDS[(col + 2 * row) % GEM_KINDS.length], 0));
    }
    rows.push(tokens.join(" "));
  }
  return rows;
}

/** A written board with `cells` written over it. */
export function withCells(
  rows: BoardRows,
  cells: readonly PlacedToken[],
): string[] {
  const grid = rows.map(tokensOf);
  for (const { col, row, token } of cells) {
    if (row < 0 || row >= grid.length || col < 0 || col >= grid[row].length) {
      fail(
        `a cell inside the ${GRID_COLS}x${GRID_ROWS} board`,
        `(${col},${row})`,
      );
    }
    // Parsed for its side effect: a typo'd token fails here, as the fixture
    // fault it is, rather than reaching the build and being reported as one of
    // the build's own.
    parseToken(token);
    grid[row][col] = token;
  }
  return grid.map((row) => row.join(" "));
}

/**
 * The quiet filler with `cells` written over it: one line poses a world.
 *
 * THE HAZARD THIS CARRIES. {@link quietBoard} holds no legal swap, and
 * specs/rules.md ends the round the moment `phase` returns to idle on a board
 * with no legal swap left. A scenario posed here that lets its chain SETTLE can
 * therefore find `screen` at `gameover` — correctly, and through no fault of the
 * build. That is what the `levels` gameover items want and what every other item
 * does not, so a scenario that must still be playing afterwards poses
 * {@link quietRowsWithEscape} instead.
 */
export function quietRowsWith(cells: readonly PlacedToken[]): string[] {
  return withCells(quietBoard(), cells);
}

/** A written board with one whole row replaced. */
export function withRow(
  rows: BoardRows,
  row: number,
  tokens: readonly string[],
): string[] {
  return withCells(
    rows,
    tokens.map((token, col) => ({ col, row, token })),
  );
}

/** A written board with one whole column replaced. */
export function withCol(
  rows: BoardRows,
  col: number,
  tokens: readonly string[],
): string[] {
  return withCells(
    rows,
    tokens.map((token, row) => ({ col, row, token })),
  );
}

/**
 * The three cells that plant ONE spare legal swap in the bottom-left corner of
 * the quiet filler, so a chain settling on it does not end the round.
 *
 * They put a beryl at `(0,7)`, at `(1,7)` and at `(2,6)`. The board still
 * carries no maximal run, and the corner is clear of the columns a mid-board
 * scenario clears and refills. It makes TWO swaps legal, both in that corner:
 * {@link ESCAPE_SWAP}, which completes the bottom row, and `(1,6)` with `(2,6)`,
 * which completes column 1 against the beryl the filler already holds at
 * `(1,5)`. Two is as good as one for the purpose — the round goes on — and
 * `harness.test.ts` proves the count so it cannot drift.
 */
export const ESCAPE_CELLS: readonly PlacedToken[] = [
  { col: 0, row: 7, token: "B0" },
  { col: 1, row: 7, token: "B0" },
  { col: 2, row: 6, token: "B0" },
];

/** The swap {@link ESCAPE_CELLS} is named for; its note gives the other. */
export const ESCAPE_SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 2, row: 6 },
  b: { col: 2, row: 7 },
};

/** A written board with {@link ESCAPE_CELLS} written over it. */
export function withEscapeSwap(rows: BoardRows): string[] {
  return withCells(rows, ESCAPE_CELLS);
}

/**
 * The quiet filler carrying both the scenario's cells and one spare legal swap.
 *
 * WHAT IT GUARANTEES, AND WHAT IT DOES NOT. The guarantee is about the POSED
 * board: it carries no run, and a legal swap exists on it, so the moment before
 * the scenario's swap the round is not over. It does NOT survive an arbitrary
 * chain — a clear reaching columns 0-2 or rows 6-7 removes the escape's own
 * cells, and R9's refill drops what is left out of position. A check that must
 * still be `playing` after its chain settles keeps its scenario clear of that
 * corner, and asserts `snapshot().legalSwap` before it reads `screen`.
 *
 * A scenario cell landing on an escape cell would silently take the escape away
 * again, so it is refused as a fixture fault rather than left to be met later as
 * an unexplained `gameover`.
 */
export function quietRowsWithEscape(cells: readonly PlacedToken[]): string[] {
  for (const { col, row } of cells) {
    const clash = ESCAPE_CELLS.find(
      (escape) => escape.col === col && escape.row === row,
    );
    if (clash !== undefined) {
      fail(
        `a scenario clear of the escape cells ` +
          `(${ESCAPE_CELLS.map((e) => `(${e.col},${e.row})`).join(", ")}), ` +
          `which are what keep the round alive`,
        `(${col},${row})`,
      );
    }
  }
  return withCells(withEscapeSwap(quietBoard()), cells);
}

/**
 * A board with no maximal run, no prism and no legal swap: the end-of-round
 * condition specs/rules.md states, posed exactly.
 *
 * `GEM_KINDS[(col + row) % 3]` — the three-kind diagonal. Three consecutive
 * cells of a row or a column carry three consecutive residues modulo 3, so they
 * are always three different kinds and the board holds no run; and exchanging
 * any two orthogonally adjacent cells leaves every line still free of three of
 * one kind, so R3 refuses every swap R1 would accept. Written out rather than
 * computed so a reader sees the board the check poses, and proved by the
 * predicates below in `harness.test.ts` so it cannot rot.
 */
export function deadBoard(): string[] {
  return [
    "R0 A0 C0 R0 A0 C0 R0 A0",
    "A0 C0 R0 A0 C0 R0 A0 C0",
    "C0 R0 A0 C0 R0 A0 C0 R0",
    "R0 A0 C0 R0 A0 C0 R0 A0",
    "A0 C0 R0 A0 C0 R0 A0 C0",
    "C0 R0 A0 C0 R0 A0 C0 R0",
    "R0 A0 C0 R0 A0 C0 R0 A0",
    "A0 C0 R0 A0 C0 R0 A0 C0",
  ];
}

/**
 * A written board with every cell but `keep` replaced by {@link WILDCARD}.
 *
 * The expected board for a reading taken after a chain step: the cells that
 * SURVIVED are asserted and every cell R9's refill could have reached is left
 * unasserted. Never assert a whole post-chain board.
 */
export function maskBoard(rows: BoardRows, keep: readonly CellRef[]): string[] {
  const wanted = new Set(keep.map(({ col, row }) => `${col},${row}`));
  return rows.map((row, index) =>
    tokensOf(row)
      .map((token, col) => (wanted.has(`${col},${index}`) ? token : WILDCARD))
      .join(" "),
  );
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Two written boards agree cell by cell, an expected {@link WILDCARD} matching
 * whatever stands there.
 *
 * A mismatch fails with each board rendered on ONE line — its rows joined by
 * ` | ` — so the runner still stores the two-line `Expected:`/`Actual:` pair it
 * renders to a reviewer, and with the first differing cell named in the context,
 * as `(3,5): expected J1, actual J0`.
 */
export function assertBoardEquals(
  actual: BoardRows,
  expected: BoardRows,
  context?: string,
): void {
  const oneLine = (rows: BoardRows): string =>
    rows.map((row) => row.trim()).join(" | ");
  const where = (detail: string): string =>
    context === undefined ? detail : `${context}: ${detail}`;
  const say = (detail: string): never =>
    fail(`${oneLine(expected)} (${where(detail)})`, oneLine(actual));

  if (actual.length !== expected.length) say(`${expected.length} rows`);
  for (let row = 0; row < expected.length; row += 1) {
    const want = tokensOf(expected[row]);
    const got = tokensOf(actual[row]);
    if (got.length !== want.length) {
      say(`row ${row}: ${want.length} tokens`);
    }
    for (let col = 0; col < want.length; col += 1) {
      if (want[col] === WILDCARD) continue;
      if (want[col] === got[col]) continue;
      say(`(${col},${row}): expected ${want[col]}, actual ${got[col]}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The move rules — R1 and R3 of specs/rules.md                               */
/* -------------------------------------------------------------------------- */

/**
 * R1: two cells are orthogonally adjacent — they differ by `1` in column and `0`
 * in row, or by `0` in column and `1` in row.
 */
export function areAdjacent(a: CellRef, b: CellRef): boolean {
  const dc = Math.abs(a.col - b.col);
  const dr = Math.abs(a.row - b.row);
  return (dc === 1 && dr === 0) || (dc === 0 && dr === 1);
}

/** The board `rows` becomes when `a` and `b` exchange the gems they hold. */
export function swapped(rows: BoardRows, a: CellRef, b: CellRef): string[] {
  return withCells(rows, [
    { col: a.col, row: a.row, token: tokenAt(rows, b.col, b.row) },
    { col: b.col, row: b.row, token: tokenAt(rows, a.col, a.row) },
  ]);
}

/** Whether one cell of a written board holds a prism. */
export function isPrism(rows: BoardRows, cell: CellRef): boolean {
  return parseToken(tokenAt(rows, cell.col, cell.row)).cut === "prism";
}

/** Whether a written board carries a prism anywhere. */
export function hasPrism(rows: BoardRows): boolean {
  return parseRows(rows).some((row) => row.some((gem) => gem.cut === "prism"));
}

/**
 * R3 alone: the board the exchange produces carries at least one maximal run, or
 * at least one of the two cells holds a prism.
 *
 * R3 says nothing about where the two cells are — that is R1's job, and
 * {@link swapIsLegal} is the two together. Keeping them apart is what lets
 * `moves/r1-non-adjacent-refused` pose a NON-adjacent pair whose exchange would
 * make a run and still say what it is posing.
 */
export function swapIsProductive(
  rows: BoardRows,
  a: CellRef,
  b: CellRef,
): boolean {
  if (isPrism(rows, a) || isPrism(rows, b)) return true;
  return hasAnyRun(swapped(rows, a, b));
}

/** Whether exchanging two cells leaves at least one maximal run on the board. */
export function swapWouldMatch(
  rows: BoardRows,
  a: CellRef,
  b: CellRef,
): boolean {
  return hasAnyRun(swapped(rows, a, b));
}

/**
 * R1 and R3 together, which is what specs/rules.md calls a legal swap: "a pair
 * of orthogonally adjacent cells whose exchange R1 and R3 both accept".
 */
export function swapIsLegal(rows: BoardRows, a: CellRef, b: CellRef): boolean {
  return areAdjacent(a, b) && swapIsProductive(rows, a, b);
}

/**
 * Every legal swap on a written board, each pair once, in reading order —
 * rightward from each cell, then downward.
 *
 * Each adjacent pair is visited from its upper-left cell alone, so a pair is
 * listed once rather than twice. The order is this function's own; nothing
 * asserts it, and a check reads the list's length or searches it by cell.
 */
export function legalSwaps(rows: BoardRows): { a: CellRef; b: CellRef }[] {
  const found: { a: CellRef; b: CellRef }[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const a = { col, row };
      for (const b of [
        { col: col + 1, row },
        { col, row: row + 1 },
      ]) {
        if (b.col >= GRID_COLS || b.row >= GRID_ROWS) continue;
        if (swapIsProductive(rows, a, b)) found.push({ a, b });
      }
    }
  }
  return found;
}

/**
 * Whether any legal swap exists on a written board.
 *
 * This is what specs/rules.md derives `snapshot().legalSwap` and the end of a
 * round from, and the two are compared in `levels/legal-swap-derived`.
 */
export function legalSwapExists(rows: BoardRows): boolean {
  return legalSwaps(rows).length > 0;
}

/* -------------------------------------------------------------------------- */
/* The resolution rules — R4, R5 and R6 of specs/rules.md                     */
/* -------------------------------------------------------------------------- */

/**
 * Every maximal run on a written board, rows first and then columns.
 *
 * R4: `MATCH_MIN` or more gems of ONE KIND on consecutive cells of a single row
 * or a single column, maximal when each of the two cells immediately beyond its
 * ends lies off the board or holds a gem of another kind. Each line is walked as
 * a sequence of same-kind stretches, so every stretch this reports is bounded by
 * an edge or by another kind and is maximal by construction. A prism belongs to
 * no kind and joins no run, so it ends one like any other mismatch.
 */
export function maximalRuns(rows: BoardRows): Run[] {
  const grid = parseRows(rows);
  const runs: Run[] = [];

  const scan = (
    lines: number,
    span: number,
    at: (line: number, index: number) => CellRef,
    horizontal: boolean,
  ): void => {
    for (let line = 0; line < lines; line += 1) {
      let start = 0;
      while (start < span) {
        const first = at(line, start);
        const kind = grid[first.row][first.col].kind;
        let end = start + 1;
        while (end < span) {
          const next = at(line, end);
          if (grid[next.row][next.col].kind !== kind) break;
          end += 1;
        }
        if (kind !== null && end - start >= MATCH_MIN) {
          const cells: CellRef[] = [];
          for (let index = start; index < end; index += 1) {
            cells.push(at(line, index));
          }
          runs.push({ cells, kind, horizontal });
        }
        start = end;
      }
    }
  };

  scan(GRID_ROWS, GRID_COLS, (row, col) => ({ col, row }), true);
  scan(GRID_COLS, GRID_ROWS, (col, row) => ({ col, row }), false);
  return runs;
}

/** Whether any maximal run stands on a written board. */
export function hasAnyRun(rows: BoardRows): boolean {
  return maximalRuns(rows).length > 0;
}

/** One cell as a string, for set membership. */
function cellKey(cell: CellRef): string {
  return `${cell.col},${cell.row}`;
}

/** Cells in reading order, from the top-left to the bottom-right. */
function inReadingOrder(cells: readonly CellRef[]): CellRef[] {
  return [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
}

/**
 * R5's ordinary seed: the union of every maximal run on the board.
 *
 * A cell lying in two crossing runs is one cell of the union, not two, which is
 * what makes the seed a SET. R5's other two seeds belong to a prism swap and are
 * stated by the items that pose one — the prism together with every gem of the
 * traded gem's kind, or every cell on the board — because each is a sentence
 * rather than a computation.
 */
export function runSeed(rows: BoardRows): CellRef[] {
  const seen = new Set<string>();
  const seed: CellRef[] = [];
  for (const run of maximalRuns(rows)) {
    for (const cell of run.cells) {
      if (seen.has(cellKey(cell))) continue;
      seen.add(cellKey(cell));
      seed.push(cell);
    }
  }
  return inReadingOrder(seed);
}

/**
 * R6: the smallest set of cells containing `seed` and closed under the three
 * additions — a `brilliant`'s eight surrounding cells, a `star`'s whole row and
 * whole column, and every flawed gem orthogonally adjacent to a cell in the set.
 *
 * Computed as a least fixed point: each cell reads its own three additions as it
 * enters the set, so a `brilliant` drawn in by a flawed neighbor brings its ring
 * in turn, which is the closure the rule asks for rather than one pass over the
 * seed. It is what `expansion/r6-closure`, `chain/chain-second-step` and
 * `scoring/score-multiplier` state their expectation with, over the board they
 * OBSERVED rather than one they predicted.
 */
export function expandClearSet(
  rows: BoardRows,
  seed: readonly CellRef[],
): CellRef[] {
  const grid = parseRows(rows);
  const inSet = new Set<string>();
  const members: CellRef[] = [];
  const pending: CellRef[] = [];
  const add = (cell: CellRef): void => {
    if (!onBoard(cell) || inSet.has(cellKey(cell))) return;
    inSet.add(cellKey(cell));
    members.push(cell);
    pending.push(cell);
  };

  for (const cell of seed) {
    if (!onBoard(cell)) {
      fail(
        `a seed cell inside the ${GRID_COLS}x${GRID_ROWS} board`,
        `(${cell.col},${cell.row})`,
      );
    }
    add(cell);
  }

  while (pending.length > 0) {
    const cell = pending.pop();
    if (cell === undefined) break;
    const gem = grid[cell.row][cell.col];
    if (gem.cut === "brilliant") {
      for (const around of ring(cell.col, cell.row)) add(around);
    }
    if (gem.cut === "star") {
      for (const along of rowAndColumn(cell.col, cell.row)) add(along);
    }
    for (const beside of neighbors(cell.col, cell.row)) {
      if (isFlawed(grid[beside.row][beside.col].strain)) add(beside);
    }
  }

  return inReadingOrder(members);
}

/** R5's ordinary seed grown to R6's clear set: what an ordinary step reads. */
export function clearSetFromRuns(rows: BoardRows): CellRef[] {
  return expandClearSet(rows, runSeed(rows));
}

/* -------------------------------------------------------------------------- */
/* Reading a written board                                                    */
/* -------------------------------------------------------------------------- */

/** The strain a written board carries at one cell. */
export function strainAt(rows: BoardRows, col: number, row: number): number {
  return parseToken(tokenAt(rows, col, row)).strain;
}

/** Whether a strain is the flawed one: `MAX_STRAIN`, from specs/board.md. */
export function isFlawed(strain: number): boolean {
  return strain >= MAX_STRAIN;
}

/**
 * Whether every gem on a written board is plain at strain 0 — the shape
 * specs/rules.md gives an opening board, and the shape R9's refill lands in.
 */
export function allPlainAndClean(rows: BoardRows): boolean {
  return parseRows(rows)
    .flat()
    .every((gem) => gem.cut === "plain" && gem.strain === 0);
}

/* -------------------------------------------------------------------------- */
/* Geometry — specs/board.md                                                  */
/* -------------------------------------------------------------------------- */

/** `cellX(col) = BOARD_CX - (GRID_COLS - 1) * CELL_PITCH / 2 + col * CELL_PITCH`. */
export function cellX(col: number): number {
  return BOARD_CX - ((GRID_COLS - 1) * CELL_PITCH) / 2 + col * CELL_PITCH;
}

/** `cellY(row) = BOARD_CY - (GRID_ROWS - 1) * CELL_PITCH / 2 + row * CELL_PITCH`. */
export function cellY(row: number): number {
  return BOARD_CY - ((GRID_ROWS - 1) * CELL_PITCH) / 2 + row * CELL_PITCH;
}

/** A cell's center on the logical stage. Centers run `x` 388..892, `y` 144..648. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: cellX(col), y: cellY(row) };
}

/** Whether a cell lies on the board. */
function onBoard(cell: CellRef): boolean {
  return (
    cell.col >= 0 &&
    cell.col < GRID_COLS &&
    cell.row >= 0 &&
    cell.row < GRID_ROWS
  );
}

/**
 * The cells orthogonally adjacent to `(col, row)` that lie on the board — the
 * adjacency R1, R6's flawed addition and R7 are all written in terms of.
 *
 * Listed in reading order. Nothing asserts the order: every rule that reads them
 * reads them as a set.
 */
export function neighbors(col: number, row: number): CellRef[] {
  return [
    { col, row: row - 1 },
    { col: col - 1, row },
    { col: col + 1, row },
    { col, row: row + 1 },
  ].filter(onBoard);
}

/**
 * The eight cells surrounding `(col, row)` that lie on the board: R6's
 * `brilliant` addition.
 *
 * Eight well inside the board, five against an edge, three at a corner — which
 * is exactly the count `expansion/r6-brilliant-edge` poses.
 */
export function ring(col: number, row: number): CellRef[] {
  const cells: CellRef[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dc === 0 && dr === 0) continue;
      const cell = { col: col + dc, row: row + dr };
      if (onBoard(cell)) cells.push(cell);
    }
  }
  return cells;
}

/**
 * Every cell of `(col, row)`'s row and every cell of its column: R6's `star`
 * addition, and the 15 cells `expansion/r6-star-row-and-column` counts.
 */
export function rowAndColumn(col: number, row: number): CellRef[] {
  const cells: CellRef[] = [];
  for (let c = 0; c < GRID_COLS; c += 1) cells.push({ col: c, row });
  for (let r = 0; r < GRID_ROWS; r += 1) {
    if (r !== row) cells.push({ col, row: r });
  }
  return cells;
}

/**
 * The midpoint of two adjacent cell centers.
 *
 * `GEM_HIT_R` (36) is half of `CELL_PITCH` (72), so this point lies EXACTLY
 * `GEM_HIT_R` from both centers — the tie specs/controls.md settles in favor of
 * the lower row, and within one row the lower column. It is the only position
 * that poses that tie, so a check about it is handed this rather than a number
 * of its own.
 */
export function betweenCells(a: CellRef, b: CellRef): { x: number; y: number } {
  if (!areAdjacent(a, b)) {
    fail(
      "two orthogonally adjacent cells, whose midpoint lies GEM_HIT_R from both",
      `(${a.col},${a.row}) and (${b.col},${b.row})`,
    );
  }
  const first = cellCenter(a.col, a.row);
  const second = cellCenter(b.col, b.row);
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * A point `(dx, dy)` from a cell's center, checked to lie inside `GEM_HIT_R` of
 * it so it really targets that cell and no other.
 */
export function insideCell(
  col: number,
  row: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const distance = Math.hypot(dx, dy);
  if (!(distance < GEM_HIT_R)) {
    fail(`an offset shorter than GEM_HIT_R (${GEM_HIT_R})`, distance);
  }
  const center = cellCenter(col, row);
  return { x: center.x + dx, y: center.y + dy };
}

/**
 * A stage point farther than `GEM_HIT_R` from EVERY cell center, so a press
 * there targets no cell.
 *
 * `(40, 40)`: the nearest center is `(388, 144)`, some 363 units away, and the
 * point is on the stage that specs/overview.md fixes, so a build that clamps a
 * pointer to the stage still receives it. `harness.test.ts` proves the distance
 * against {@link distanceToNearestCell} rather than trusting this arithmetic.
 */
export function offBoardPoint(): { x: number; y: number } {
  return { x: 40, y: 40 };
}

/** How far a stage point lies from the nearest cell center. */
export function distanceToNearestCell(x: number, y: number): number {
  let nearest = Infinity;
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const center = cellCenter(col, row);
      nearest = Math.min(nearest, Math.hypot(center.x - x, center.y - y));
    }
  }
  return nearest;
}
