// Facet — board/load-board: `loadBoard` poses the board that was written, cell
// for cell, and leaves the game in the state the operation names.
//
// WHY THIS ONE IS LOAD-BEARING. Almost every automated item in this project
// arranges its scenario with this single operation. A build whose `loadBoard`
// drops a cut, clamps a strain, or reads the rows transposed does not merely
// fail here — it hands every other check a board nobody wrote, and each of those
// checks then reports a verdict about a world that never existed. So the pose is
// read directly, against the tokens the fixture named, before anything is asked
// of the rules.
//
// WHAT THE FIXTURE COVERS, AND WHY IT COVERS IT. specs/board.md writes a cell as
// three independent parts — a kind letter, a strain digit, and an optional cut
// letter — and a build can carry one part and lose another. The posed board
// therefore writes all seven kind letters and the prism letter `X`, all four
// strain digits `0`-`3`, and every cut the notation can write: `plain` by its
// absent letter, `brilliant` by `b`, `star` by `s`, and `prism` by `X`. A prism
// is checked apart from the rest, because specs/board.md gives it no kind and
// the snapshot shape reports its `kind` as `null`.
//
// EVERY CELL REPORTS A `fell` OF `0`. specs/instrumentation.md says so of this
// operation outright — "Every gem of a posed board is standing still where it was
// written, so every cell reports a `fell` of `0`" — and it follows from the
// notation itself, which records where every gem STANDS and nothing about how it
// got there. A build that carried the figure over from whatever the board held
// before, or that gave a posed board the fall a dealt one gets, hands every check
// that reads the fall a board nobody wrote.
//
// THE STATE IS POSED FROM ONE THAT CONTRADICTS IT. specs/instrumentation.md
// requires the operation to leave `phase` `idle`, `chainStep`, `swapTimer` and
// `stepTimer` at `0`, no selection, no offer and no refusal — and every one of
// those already holds on a title screen, so posing from rest would read nothing.
// The second check below therefore sets a move running, gives it a selection, an
// offer and a standing refusal, and poses the board over THAT, where each of the
// seven fields has something to clear.
//
// THE POSE IS READ AT THE CALL. specs/instrumentation.md says `loadBoard` takes
// effect when it is called, so every reading below is the one it returned, with
// no frame advanced. What the board does over game time afterwards is
// `board/board-rests`, and to keep the two apart this fixture carries no maximal
// run at all: every row and every column steps one kind at a time, and a prism
// joins no run under R4, so there is nothing on it a chain could read even if the
// build read it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBoardEquals,
  parseRows,
  quietRowsWithEscape,
  renderBoard,
  tokenAt,
  type PlacedToken,
} from "../board";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertNull,
  fail,
} from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";

/**
 * The board this point poses, in the notation of specs/board.md.
 *
 * Read as a picture: each row walks the seven kinds in `GEM_KINDS` order and
 * wraps, so no three consecutive cells of any row or column share a kind and the
 * board carries no maximal run. The strain digits cycle `0 1 2 3` down the left
 * columns, the `b` and `s` cut letters walk a diagonal through the middle so that
 * no two cut gems share a row or a column, and the last row is the four prisms,
 * one at each strain.
 */
const POSED = [
  "R0 A1 C2 J3 B0b S1b M2s R3s",
  "A0 C1 J2 B3 S0b M1s R2 A3",
  "C0 J1 B2 S3 M0s R1b A2 C3",
  "J0 B1 S2 M3 R0b A1s C2 J3",
  "B0 S1 M2 R3 A0s C1b J2 B3",
  "S0 M1 R2 A3 C0b J1s B2 S3",
  "M0 R1 A2 C3 J0s B1b S2 M3",
  "X0 X1 X2 X3 R0 A0 C0 J0",
];

/**
 * Three rubies one swap short of a run, on the quiet filler.
 *
 * Exchanging `(3,3)` with `(3,4)` carries the third ruby into row `4` and R3
 * accepts, which is how the state this point poses over gets a chain to be
 * running in the first place.
 */
const CHARGED_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The board that chain is started on. */
const CHARGED = quietRowsWithEscape(CHARGED_CELLS);

/** The cell held, and the neighbor it is offered into, when the board is posed. */
const HELD = { col: 2, row: 6 };
const OFFERED = { col: 3, row: 6 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves to playing from the screen the game was on", async () => {
  // The harness opens on the title screen with no board in play, so the move to
  // `playing` is something this call did rather than something already true.
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen before the board is posed");

  const posed = await loadBoard(h, POSED);
  assertEqual(posed.screen, "playing", "screen");

  // And a board really is in play: the snapshot's resting value for `board` is
  // an empty grid, so the dimensions and the count are what tell a posed board
  // apart from none at all.
  assertEqual(posed.board.cols, GRID_COLS, "board.cols");
  assertEqual(posed.board.rows, GRID_ROWS, "board.rows");
  assertLength(posed.board.cells, GRID_COLS * GRID_ROWS, "board.cells");
});

it("leaves no move, no selection, no offer and no refusal behind it", async () => {
  // Arrange the contradiction. A swap is accepted and carried through its own
  // animation, so `phase` is `resolving` with `chainStep` at 1 and `stepTimer`
  // carrying the game time the step has already run; a cell is selected and a
  // neighbor offered into; and a swap R1 refuses — the two cells are four apart
  // — leaves a refusal standing. Every field the operation is required to clear
  // now holds something to clear.
  await loadBoard(h, CHARGED);
  await swapAndStep(h, { col: 3, row: 3 }, { col: 3, row: 4 });
  await h.debug.setSelection(HELD.col, HELD.row);
  await h.debug.setOffer(OFFERED.col, OFFERED.row);
  await h.debug.requestSwap(0, 0, 4, 0);

  const busy = await h.snapshot();
  assertEqual(busy.phase, "resolving", "phase before the board is posed");
  assertGreaterThan(busy.chainStep, 0, "chainStep before the board is posed");
  assertGreaterThan(busy.stepTimer, 0, "stepTimer before the board is posed");
  assertNotNull(busy.selection, "selection before the board is posed");
  assertNotNull(busy.offer, "offer before the board is posed");
  assertNotNull(busy.refusal, "refusal before the board is posed");

  // Every field specs/instrumentation.md names for `loadBoard`. `chainStep`,
  // `swapTimer` and `stepTimer` are the three that say no move is in motion;
  // `selection`, `offer` and `refusal` are the three that say the operation
  // posed a board and left nothing of the situation it interrupted.
  const posed = await loadBoard(h, POSED);
  assertEqual(posed.phase, "idle", "phase");
  assertEqual(posed.chainStep, 0, "chainStep");
  assertEqual(posed.swapTimer, 0, "swapTimer");
  assertEqual(posed.stepTimer, 0, "stepTimer");
  assertNull(posed.selection, "selection");
  assertNull(posed.offer, "offer");
  assertNull(posed.refusal, "refusal");
});

it("carries the kind, the cut and the strain every one of the 64 tokens named", async () => {
  const posed = await loadBoard(h, POSED);

  // One frame, so the picture kept below is the posed board rather than the
  // title screen the frame before it left on the canvas. The reading asserted is
  // the one `loadBoard` returned, taken before this frame ran.
  await h.advance(1);
  await captureStill(h, "posed");

  // The whole board at once, which is what makes a wrong cell legible: the two
  // boards are rendered back into the notation and the first cell that differs
  // is named, rather than sixty-four separate comparisons of which one fails.
  assertBoardEquals(renderBoard(posed), POSED, "the board posed by loadBoard");

  // Then the three fields the notation folds into one token, read apart. This is
  // not a repetition of the comparison above: a token is written from the cut
  // alone when that cut is `prism`, so a build reporting a prism that still
  // carries a kind renders as `X` and passes the board comparison. The `null`
  // specs/instrumentation.md requires of a prism's `kind` is only visible here.
  const written = parseRows(POSED);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const want = written[row][col];
      const cell = posed.board.cells.find(
        (candidate) => candidate.col === col && candidate.row === row,
      );
      if (cell === undefined)
        fail(`a cell reported at (${col},${row})`, "none");
      const where = `(${col},${row}), written ${tokenAt(POSED, col, row)}`;
      assertEqual(cell.kind, want.kind, `${where}: kind`);
      assertEqual(cell.cut, want.cut, `${where}: cut`);
      assertEqual(cell.strain, want.strain, `${where}: strain`);
      // The fourth field, which the notation does not write and the operation
      // fixes outright: a gem written at a cell is standing still in it.
      assertEqual(cell.fell, 0, `${where}: fell`);
    }
  }
});
