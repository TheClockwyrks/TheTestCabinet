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
// else — no engine, no browser, no harness — which is what lets a check recompute
// a rule, pose a fixture or measure a distance without standing a build up, and
// what lets one text serve three architectures.
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
//  - The NOTATION, the CELL-CENTER FORMULAS, the RUN, SWAP and CLEAR-SET
//    predicates, the SETTLING, the STEP'S THREE SPANS and the POINTER-TARGET
//    requirements are specs/board.md, specs/rules.md and specs/controls.md
//    written down. They are the case restating the contract, and each one names
//    the rule it is. Two of them are deliberately WEAKER than an equality: R9
//    fixes a refilled gem's fall only as a floor, and specs/controls.md fixes a
//    target's rectangle only by four requirements, so this file expresses both
//    as bounds a build satisfies rather than as a figure a build must match.
//  - The FIXTURES (`quietBoard`, `deadBoard`, `ESCAPE_CELLS`, and the helpers
//    that write cells over them) are the case's own scenery, chosen so a scenario
//    poses exactly one thing and nothing else. No check stands here to prove a
//    fixture once and for all, so a scenario that rests on one asserts it with
//    the predicates below over the board it actually posed, rather than
//    trusting the construction that produced it — a fixture that quietly
//    stopped being quiet would turn every check built on it into a lie.
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
  FALL_SECONDS_PER_ROW,
  GEM_HIT_R,
  GEM_KINDS,
  GRID_COLS,
  GRID_ROWS,
  MATCH_MIN,
  MAX_STRAIN,
  STAGE_H,
  STAGE_W,
  STEP_SECONDS,
  TARGET_MIN_H,
  TARGET_MIN_W,
  WAVE_SECONDS,
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
  /**
   * How many rows the gem traveled to reach the cell it holds, under R9.
   *
   * The notation carries no `fell` — "every gem of a board written in it is
   * standing still in the cell it is written at" — so a gem read out of a token
   * carries `0`, and {@link settleBoard} is what puts any other figure on one.
   */
  fell: number;
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
 * R9 draws a refill's kind at random, so what lands in a refilled cell is the
 * build's business and no check may assert it unless the check posed it. A
 * check about a chain states the cells that SURVIVED and writes this at every
 * cell the refill could have reached, or poses the refill through
 * `setRefillKinds` and states the posed token there.
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
    return { kind: null, cut: "prism", strain, fell: 0 };
  }
  const cut = CUT_LETTERS[suffix];
  if (cut === undefined) {
    fail(`a cut letter of b or s (token ${token})`, suffix);
  }
  const index = KIND_LETTERS.indexOf(letter as (typeof KIND_LETTERS)[number]);
  return { kind: GEM_KINDS[index], cut, strain, fell: 0 };
}

/**
 * The cell token that names a gem, the inverse of {@link parseToken}.
 *
 * A prism is written by its cut alone, since specs/board.md gives it no kind to
 * write; a gem of any other cut that carries no kind is not a gem the notation
 * can write, and says so.
 *
 * It takes the three fields the notation writes rather than a whole {@link Gem},
 * because `fell` is not one of them: a written board records where every gem
 * stands and nothing about how it got there.
 */
export function formatToken(gem: {
  kind: GemKind | null;
  cut: Cut;
  strain: number;
}): string {
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
 * `instrumentation/debug-api-snapshot-shape` is where it is asked — which is also
 * where a cell
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
 * Both properties rest on the argument above and on nothing else, so a scenario
 * that leans on either one asserts it with {@link maximalRuns} or
 * {@link legalSwapExists} over the board it actually posed.
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
 * `(1,5)`. Two is as good as one for the purpose — the round goes on — and the
 * count is argued here rather than proved: a check that must know a swap is
 * still there reads {@link legalSwaps} over the board it actually posed.
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
 * computed so a reader sees the board the check poses, and asserted with
 * {@link hasAnyRun} and {@link legalSwapExists} by the scenarios whose point
 * turns on the board being dead, so the literals written here cannot rot
 * unnoticed.
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
 * `moves/r1-diagonal-refused` and `moves/r1-distant-refused` pose a NON-adjacent
 * pair whose exchange would
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
 * R6's clear set, with the wave R6 gave each of its cells.
 *
 * The two travel together because they come out of one traversal and a check
 * about either reads the other: the set is what the step scores and removes, and
 * the waves are what time its shattering.
 */
export interface ClearSet {
  /** Every cell of the set, in reading order from the top-left. */
  cells: CellRef[];
  /** The wave of the cell at the same index of {@link cells}. */
  waves: number[];
  /**
   * The figure specs/rules.md calls the set's `waves`: the greatest wave in it,
   * and `0` when the set is its seed alone. It is what a step leaves behind as
   * `lastWaves`, and the first of the two figures {@link stepHold} runs off.
   */
  greatestWave: number;
}

/**
 * R6: the smallest set of cells containing `seed` and closed under the three
 * additions — a `brilliant`'s eight surrounding cells, a `star`'s whole row and
 * whole column, and every flawed gem orthogonally adjacent to a cell in the set
 * — with each cell's wave.
 *
 * Computed as a least fixed point, BREADTH FIRST from the seed. Each cell reads
 * its own three additions as it enters the set, so a `brilliant` drawn in by a
 * flawed neighbor brings its ring in turn, which is the closure the rule asks
 * for rather than one pass over the seed. Visiting in the order cells entered is
 * what makes the wave right as well as the membership: every seed cell is at
 * wave `0`, a cell an addition brings in from a cell at wave `k` is at `k + 1`,
 * and the first wave to reach a cell is the lowest any addition could, so the
 * wave a cell is written with is never lowered later.
 *
 * The wave changes nothing about which cells the set holds, so the membership
 * this returns is the membership the two `expansion/r6-closure-*` points,
 * `chain/chain-second-step` and `scoring/score-multiplier` state their
 * expectation with, over the board they OBSERVED rather than one they predicted.
 */
export function expandClearSetInWaves(
  rows: BoardRows,
  seed: readonly CellRef[],
): ClearSet {
  const grid = parseRows(rows);
  const waveOf = new Map<string, number>();
  const entered: CellRef[] = [];
  const add = (cell: CellRef, wave: number): void => {
    if (!onBoard(cell) || waveOf.has(cellKey(cell))) return;
    waveOf.set(cellKey(cell), wave);
    entered.push(cell);
  };

  for (const cell of seed) {
    if (!onBoard(cell)) {
      fail(
        `a seed cell inside the ${GRID_COLS}x${GRID_ROWS} board`,
        `(${cell.col},${cell.row})`,
      );
    }
    add(cell, 0);
  }

  for (let head = 0; head < entered.length; head += 1) {
    const cell = entered[head];
    const next = (waveOf.get(cellKey(cell)) ?? 0) + 1;
    const gem = grid[cell.row][cell.col];
    if (gem.cut === "brilliant") {
      for (const around of ring(cell.col, cell.row)) add(around, next);
    }
    if (gem.cut === "star") {
      for (const along of rowAndColumn(cell.col, cell.row)) add(along, next);
    }
    for (const beside of neighbors(cell.col, cell.row)) {
      if (isFlawed(grid[beside.row][beside.col].strain)) add(beside, next);
    }
  }

  const cells = inReadingOrder(entered);
  const waves = cells.map((cell) => waveOf.get(cellKey(cell)) ?? 0);
  return {
    cells,
    waves,
    greatestWave: waves.reduce((deepest, wave) => Math.max(deepest, wave), 0),
  };
}

/**
 * R6's clear set alone, for the checks that are about membership.
 *
 * The same traversal as {@link expandClearSetInWaves} with the waves dropped, so
 * the two can never disagree about what the set holds.
 */
export function expandClearSet(
  rows: BoardRows,
  seed: readonly CellRef[],
): CellRef[] {
  return expandClearSetInWaves(rows, seed).cells;
}

/** R5's ordinary seed grown to R6's clear set and its waves. */
export function clearSetInWavesFromRuns(rows: BoardRows): ClearSet {
  return expandClearSetInWaves(rows, runSeed(rows));
}

/** R5's ordinary seed grown to R6's clear set: what an ordinary step reads. */
export function clearSetFromRuns(rows: BoardRows): CellRef[] {
  return expandClearSet(rows, runSeed(rows));
}

/* -------------------------------------------------------------------------- */
/* Settling — R9 of specs/rules.md                                            */
/* -------------------------------------------------------------------------- */

/**
 * How far a gem traveled, as a check may hold a build to it.
 *
 * TWO CASES, AND THE TYPE IS WHAT KEEPS THEM APART. R9 fixes a surviving gem's
 * `fell` exactly — its new row less its old row, and `0` for one it did not move
 * — so a check asserts that figure and nothing else. It fixes a refilled gem's
 * only as a floor: "a gem the refill dealt into row `r`" carries "at least
 * `r + 1`", and "which figure at or above that each refilled gem carries is the
 * build's". A build that drops its refill in from two rows above the board
 * conforms exactly as one that drops it in from one row above does.
 *
 * So the two are different shapes rather than one number with a flag. A check
 * cannot read `exactly` off a refilled cell without the compiler saying so,
 * which is the whole point: an exact expectation written against a refill would
 * fail a conforming build, and the failure would read as a defect in the build
 * rather than as the check's own mistake.
 */
export type Fell = { readonly exactly: number } | { readonly atLeast: number };

/** Whether a `fell` a build reported satisfies what R9 fixes for its cell. */
export function fellHolds(expected: Fell, actual: number): boolean {
  return "exactly" in expected
    ? actual === expected.exactly
    : actual >= expected.atLeast;
}

/** A {@link Fell} written for a failure message: `2`, or `at least 3`. */
export function showFell(expected: Fell): string {
  return "exactly" in expected
    ? String(expected.exactly)
    : `at least ${expected.atLeast}`;
}

/** One reported `fell` held to what R9 fixes for its cell. */
export function assertFell(
  actual: number,
  expected: Fell,
  context?: string,
): void {
  if (fellHolds(expected, actual)) return;
  const bound = showFell(expected);
  fail(context === undefined ? bound : `${bound} (${context})`, actual);
}

/** One cell of the board R9 left: the gem standing in it, and its `fell`. */
export interface SettledCell {
  col: number;
  row: number;
  /**
   * The token the cell holds, and {@link WILDCARD} where the refill dealt the
   * gem without a pose: R9 draws a refill's kind at random, so what lands there
   * is the build's business and no check may assert it. A refill the check
   * posed is written as the posed kind, plain at strain `0`.
   */
  token: string;
  /** What R9 fixes as this gem's `fell`. */
  fell: Fell;
}

/** The board R9 leaves, cell by cell. */
export interface Settlement {
  /**
   * The board in the notation, one string per row, every refilled cell written
   * as {@link WILDCARD} — the expected board {@link assertBoardEquals} takes.
   */
  rows: string[];
  /** Every cell of it, in reading order from the top-left. */
  cells: SettledCell[];
  /** The cells the refill dealt into, in reading order. */
  refilled: CellRef[];
  /**
   * The figure specs/rules.md calls the board's `fall`: the greatest `fell` on
   * it. It is what a step leaves behind as `lastFall`, and the second of the two
   * figures {@link stepHold} runs off.
   *
   * A board carrying any refilled cell reports it as a floor rather than a
   * figure, because a refill's own `fell` is a floor and the greatest of a set
   * with a floor in it is one too.
   */
  fall: Fell;
}

/**
 * R9: within each column every surviving gem falls to the lowest empty cell
 * below it, keeping its order and carrying its strain and its cut, and each cell
 * still empty is refilled from the top.
 *
 * `emptied` names the cells standing empty when R9 runs. The tokens `rows`
 * carries at those cells are what the removal took away, and they are ignored,
 * so a caller poses a step by handing over the board it started on and the clear
 * set that was taken off it.
 *
 * R8 RUNS BEFORE THIS ONE. A created gem "occupies the cell it is placed at,
 * which the removal left empty", so it is standing on the board by the time R9
 * reads it and falls like any other survivor. A caller that poses a step with a
 * cut in it writes the created gem over `rows` with {@link withCells} and leaves
 * its cell out of `emptied`, and this settles it correctly with no further
 * argument.
 *
 * `refillKinds` is the pose `setRefillKinds` stands in for the draw with, in
 * the snapshot's own shape: one string per column, the letter at index `r`
 * being the kind the refill deals into row `r`. A refilled cell the pose names
 * is written as that kind, plain at strain `0`; every other refilled cell is
 * {@link WILDCARD}.
 */
export function settleBoard(
  rows: BoardRows,
  emptied: readonly CellRef[],
  refillKinds: readonly string[] = [],
): Settlement {
  const grid = parseRows(rows);
  const empty = new Set<string>();
  for (const cell of emptied) {
    if (!onBoard(cell)) {
      fail(
        `an emptied cell inside the ${GRID_COLS}x${GRID_ROWS} board`,
        `(${cell.col},${cell.row})`,
      );
    }
    empty.add(cellKey(cell));
  }

  const placed: string[][] = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => WILDCARD),
  );
  const fellOf = new Map<string, Fell>();
  const refilled: CellRef[] = [];

  for (let col = 0; col < GRID_COLS; col += 1) {
    // The survivors of one column, read from the bottom up and dropped back in
    // from the bottom up, which is what keeps "the order its column held it in".
    let target = GRID_ROWS - 1;
    for (let row = GRID_ROWS - 1; row >= 0; row -= 1) {
      if (empty.has(cellKey({ col, row }))) continue;
      placed[target][col] = formatToken(grid[row][col]);
      fellOf.set(cellKey({ col, row: target }), { exactly: target - row });
      target -= 1;
    }
    for (let row = target; row >= 0; row -= 1) {
      // A refill comes from above the board's top row, so `row + 1` rows is the
      // least it can have traveled, and the token it lands as is the build's
      // unless the check posed it.
      fellOf.set(cellKey({ col, row }), { atLeast: row + 1 });
      refilled.push({ col, row });
      const letter = refillKinds[col]?.[row];
      if (letter !== undefined) placed[row][col] = `${letter}0`;
    }
  }

  const cells: SettledCell[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      cells.push({
        col,
        row,
        token: placed[row][col],
        fell: fellOf.get(cellKey({ col, row })) ?? { exactly: 0 },
      });
    }
  }

  let greatest = 0;
  for (const cell of cells) {
    const figure =
      "exactly" in cell.fell ? cell.fell.exactly : cell.fell.atLeast;
    greatest = Math.max(greatest, figure);
  }

  return {
    rows: placed.map((row) => row.join(" ")),
    cells,
    refilled: inReadingOrder(refilled),
    fall: refilled.length > 0 ? { atLeast: greatest } : { exactly: greatest },
  };
}

/** What R9 fixes as the `fell` of one cell of a settlement. */
export function fellAt(settlement: Settlement, col: number, row: number): Fell {
  const cell = settlement.cells.find(
    (candidate) => candidate.col === col && candidate.row === row,
  );
  if (cell === undefined) {
    fail(`a settled cell at (${col},${row})`, "none");
  }
  return cell.fell;
}

/* -------------------------------------------------------------------------- */
/* A step's three spans — specs/rules.md                                      */
/* -------------------------------------------------------------------------- */
//
// A step's hold is the step's OWN figure rather than a constant: it is built
// from the `waves` R6 gave the step's clear set and the `fall` R9 left on the
// board, both of which the step decides for itself. These three write down the
// table specs/rules.md gives, so a harness driving a step to its end and a check
// reading `snapshot().stepHold` are asking the same arithmetic.

/** `SHATTER_END = lastWaves * WAVE_SECONDS`: when the last cell has shattered. */
export function shatterEnd(lastWaves: number): number {
  return lastWaves * WAVE_SECONDS;
}

/**
 * `LAND_AT = SHATTER_END + lastFall * FALL_SECONDS_PER_ROW`: when the last gem
 * has landed, and the moment the `land` cue plays on.
 */
export function landAt(lastWaves: number, lastFall: number): number {
  return shatterEnd(lastWaves) + lastFall * FALL_SECONDS_PER_ROW;
}

/**
 * `STEP_HOLD = LAND_AT + STEP_SECONDS`: how long a step holds the board before
 * it is read again, which is what `snapshot().stepHold` reports.
 */
export function stepHold(lastWaves: number, lastFall: number): number {
  return landAt(lastWaves, lastFall) + STEP_SECONDS;
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
 * pointer to the stage still receives it. A check that presses here asserts the
 * distance with {@link distanceToNearestCell} rather than trusting this
 * arithmetic.
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

/* -------------------------------------------------------------------------- */
/* Pointer targets — specs/controls.md                                        */
/* -------------------------------------------------------------------------- */
//
// WHERE A TARGET COMES FROM, AND WHY NONE OF THEM IS WRITTEN DOWN HERE. A
// target's rectangle is the BUILD's: specs/controls.md fixes each screen's ids
// and four requirements over every rectangle, and leaves "what each target looks
// like ... the build's to design". So this file states no rectangle at all. A
// check reads the screen's targets off `snapshot().targets`, which reports "the
// one the game actually hit-tests against", and holds what it read to the four
// requirements below.

/** One pointer target, as a snapshot reports it: an id and a rectangle. */
export interface TargetRect {
  id: string;
  /** The rectangle's top-left corner, in the stage's logical units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The center of a target, which is where a check presses to take it. */
export function targetCenter(target: TargetRect): { x: number; y: number } {
  return { x: target.x + target.w / 2, y: target.y + target.h / 2 };
}

/** A target measures at least `TARGET_MIN_W` by `TARGET_MIN_H`. */
export function targetIsBigEnough(target: TargetRect): boolean {
  return target.w >= TARGET_MIN_W && target.h >= TARGET_MIN_H;
}

/** A target lies wholly within the `STAGE_W x STAGE_H` stage. */
export function targetIsOnStage(target: TargetRect): boolean {
  return (
    target.x >= 0 &&
    target.y >= 0 &&
    target.x + target.w <= STAGE_W &&
    target.y + target.h <= STAGE_H
  );
}

/**
 * Two targets overlap: their rectangles share area.
 *
 * Strict on every edge, so two targets laid edge to edge are separate. A shared
 * boundary line has no area, and specs/controls.md asks that "no two targets on
 * one screen overlap" so that "a pointer position lies in at most one target" —
 * which a shared edge does not put at risk in any build that hit-tests a
 * half-open rectangle.
 */
export function targetsOverlap(a: TargetRect, b: TargetRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * The stage the board occupies on `playing`, as a rectangle.
 *
 * Cell centers run `x` `388..892` and `y` `144..648`, and this is that span
 * grown by `GEM_HIT_R` (`36`) on every side, so it runs `x` `352..928` and `y`
 * `108..684`.
 *
 * `GEM_HIT_R` RATHER THAN `GEM_R`. specs/controls.md puts the `pause` target
 * "wholly outside the board's extent ... so it never covers a cell", and a cell
 * is covered wherever the pointer would target it, which specs/board.md puts at
 * `GEM_HIT_R` of its center rather than at the `GEM_R` its drawn form fits
 * inside. specs/instrumentation.md resolves a press against a cell only "outside
 * that screen's `pause` target", so a target reaching inside `GEM_HIT_R` of a
 * center would take presses meant for that gem and make part of the board
 * unplayable. That is the reading under which the specification's own stated
 * consequence holds, so it is the one this measures.
 */
export function boardExtent(): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const left = cellX(0) - GEM_HIT_R;
  const top = cellY(0) - GEM_HIT_R;
  return {
    x: left,
    y: top,
    w: cellX(GRID_COLS - 1) + GEM_HIT_R - left,
    h: cellY(GRID_ROWS - 1) + GEM_HIT_R - top,
  };
}

/** A target shares no area with {@link boardExtent}. */
export function targetClearsBoard(target: TargetRect): boolean {
  return !targetsOverlap(target, { id: "board", ...boardExtent() });
}

/**
 * The first requirement a screen's reported targets break, worded for a failure,
 * or `null` when they break none.
 *
 * The four requirements are specs/controls.md's, and they are asked of the set
 * rather than of one rectangle, because the third is about a pair. `onPlaying`
 * adds the fifth sentence that screen carries alone — the `pause` target lies
 * clear of the board — since every other screen has no board under it.
 *
 * A sentence rather than a boolean: several checks read these targets, each for
 * its own screen, and a reviewer reading one of their failures needs to be told
 * which target broke which requirement and by how much.
 */
export function targetFault(
  targets: readonly TargetRect[],
  onPlaying: boolean,
): string | null {
  for (const target of targets) {
    if (!targetIsBigEnough(target)) {
      return (
        `target ${target.id} measures ${target.w}x${target.h}, under the ` +
        `${TARGET_MIN_W}x${TARGET_MIN_H} a fingertip needs`
      );
    }
    if (!targetIsOnStage(target)) {
      return (
        `target ${target.id} runs from (${target.x},${target.y}) to ` +
        `(${target.x + target.w},${target.y + target.h}), off the ` +
        `${STAGE_W}x${STAGE_H} stage`
      );
    }
    if (onPlaying && !targetClearsBoard(target)) {
      const board = boardExtent();
      return (
        `target ${target.id} runs from (${target.x},${target.y}) to ` +
        `(${target.x + target.w},${target.y + target.h}), over the board's ` +
        `extent from (${board.x},${board.y}) to ` +
        `(${board.x + board.w},${board.y + board.h})`
      );
    }
  }
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      if (targetsOverlap(targets[i], targets[j])) {
        return `targets ${targets[i].id} and ${targets[j].id} overlap`;
      }
    }
  }
  return null;
}

/** A screen's reported targets held to all of {@link targetFault}'s requirements. */
export function assertTargetsConform(
  targets: readonly TargetRect[],
  onPlaying: boolean,
  context?: string,
): void {
  const fault = targetFault(targets, onPlaying);
  if (fault === null) return;
  const wanted =
    `every target at least ${TARGET_MIN_W}x${TARGET_MIN_H}, wholly on the ` +
    `stage, and clear of every other` +
    (onPlaying ? " and of the board" : "");
  fail(context === undefined ? wanted : `${wanted} (${context})`, fault);
}
