// Facet — board/load-board-leaves-the-rest: the board is the whole of what
// `loadBoard` writes.
//
// specs/instrumentation.md states it of the operation in as many words: "The
// board is the whole of what it writes: the screen, `menuIndex`, the phase and
// its timers, the selection, the offer, the refusal, and every figure of the
// round stand where they were."
//
// WHY IT IS ITS OWN POINT. A build that quietly settled the chain, put the
// selection away or moved to `playing` on every posed board would pass every
// check that only reads the cells, and would silently rewrite the world under
// every check that poses a board over a move already in motion — which is what
// `writeBoard` exists for and what the game-over and level-clear scenarios in
// this project are built on. The reading is therefore taken over a state that
// CONTRADICTS a reset on every field at once.
//
// THE STATE IS POSED FROM ONE THAT CONTRADICTS IT. Each of the fields named
// already holds its resting value on a title screen, so posing from rest would
// read nothing. The check below sets a move running, gives it a selection, an
// offer and a standing refusal, poses the figures of a round that has been
// played, and writes the board over THAT — where each field has something to
// lose.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBoardEquals,
  quietRowsWithEscape,
  renderBoard,
  type PlacedToken,
} from "../board";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  swapAndStep,
  writeBoard,
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

/** Figures of a round in progress, posed so the write below has them to lose. */
const PLAYED_SCORE = 4321;
const PLAYED_LEVEL = 3;
const PLAYED_LEVEL_SCORE = 777;
const PLAYED_MENU_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the screen, the move, the selection and the round's figures standing", async () => {
  // Arrange the contradiction. A swap is accepted and carried through its own
  // animation, so `phase` is `resolving` with `chainStep` at 1 and `stepTimer`
  // carrying the game time the step has already run; a cell is selected and a
  // neighbor offered into; a swap R1 refuses — the two cells are four apart —
  // leaves a refusal standing; and the round's figures are posed off their
  // resting values. Every field the operation is required to LEAVE ALONE now
  // holds something it could lose.
  await loadBoard(h, CHARGED);
  await swapAndStep(h, { col: 3, row: 3 }, { col: 3, row: 4 });
  await h.debug.setSelection(HELD.col, HELD.row);
  await h.debug.setOffer(OFFERED.col, OFFERED.row);
  await h.debug.requestSwap(0, 0, 4, 0);
  await h.debug.setScore(PLAYED_SCORE);
  await h.debug.setLevel(PLAYED_LEVEL);
  await h.debug.setLevelScore(PLAYED_LEVEL_SCORE);
  await h.debug.setMenuIndex(PLAYED_MENU_INDEX);

  const busy = await h.snapshot();
  assertEqual(busy.phase, "resolving", "phase before the board is posed");
  assertGreaterThan(busy.chainStep, 0, "chainStep before the board is posed");
  assertGreaterThan(busy.stepTimer, 0, "stepTimer before the board is posed");
  assertNotNull(busy.selection, "selection before the board is posed");
  assertNotNull(busy.offer, "offer before the board is posed");
  assertNotNull(busy.refusal, "refusal before the board is posed");

  // The board is written, through the operation itself with nothing around it.
  const posed = await writeBoard(h, POSED);

  // The cells really did change, so what follows is read after a write that
  // happened rather than after a call the build ignored.
  assertBoardEquals(renderBoard(posed), POSED, "the board posed by loadBoard");

  // And every field specs/instrumentation.md names as standing where it was.
  assertEqual(posed.screen, busy.screen, "screen");
  assertEqual(posed.menuIndex, busy.menuIndex, "menuIndex");
  assertEqual(posed.phase, busy.phase, "phase");
  assertEqual(posed.chainStep, busy.chainStep, "chainStep");
  assertEqual(posed.swapTimer, busy.swapTimer, "swapTimer");
  assertEqual(posed.stepTimer, busy.stepTimer, "stepTimer");
  assertDeepEqual(posed.selection, busy.selection, "selection");
  assertDeepEqual(posed.offer, busy.offer, "offer");
  assertDeepEqual(posed.refusal, busy.refusal, "refusal");
  assertEqual(posed.score, busy.score, "score");
  assertEqual(posed.level, busy.level, "level");
  assertEqual(posed.levelScore, busy.levelScore, "levelScore");

  // The picture the reviewer sees: one frame after the write, so the board on
  // the canvas is the written one and the move the write left running is still
  // running under it. Taken after every reading above, so nothing it advances
  // can reach an assertion.
  await h.advance(1);
  await captureStill(h, "standing");
});
