// Refract — tracing/helpers: boards and readings private to the tracing
// category. CASE-PROVIDED.
//
// The shared fixtures in `fixtures.ts` pose the ruleset's refusals; the two
// boards here pose tracing situations those do not: a plain one-channel line
// long enough to draw, shorten, and unwind a beam on without ever solving the
// board, and a two-beam board whose shared node is a MID cell of both beams,
// so a press there matches no row of the grab table (`specs/controls.md`).
// Both are written in the notation `specs/board.md` defines.

import type { RefractSnapshot } from "../harness";

/**
 * A 5x1 single-channel line: T(0,0), lenses at (1,0), (2,0), (3,0), T(4,0).
 *
 * Any partial beam on it — up to [A, B, C, D] — leaves lenses uncovered or an
 * emitter unmet, so nothing a tracing scenario draws here solves the board and
 * the trace machinery stays live throughout (`specs/beams.md` R6/R7/R9).
 */
export const LINE_5 = "TtttT";

/**
 * Two beams through one MID node, unsolvable into a solved screen: the
 * crystal at (1,0) carries two charges; triangle crosses it straight along the
 * top and square crosses it by two diagonals of different 2x2 blocks. The
 * triangle lens at (3,0) stays uncovered, so the board is never solved with
 * both beams drawn, and (1,0) is an END of neither beam — a press there is a
 * press on a node MORE THAN ONE beam passes through (`specs/controls.md`).
 */
export const SHARED_MID = `
T2Tt
S.S.
`;

/** The route that crosses SHARED_MID's crystal with the triangle beam. */
export const SHARED_MID_TRIANGLE: readonly { col: number; row: number }[] = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 2, row: 0 },
];

/** The route that crosses SHARED_MID's crystal with the square beam. */
export const SHARED_MID_SQUARE: readonly { col: number; row: number }[] = [
  { col: 0, row: 1 },
  { col: 1, row: 0 },
  { col: 2, row: 1 },
];

/**
 * The game-facing fields of a snapshot: everything the state holds about the
 * game itself, without the fields the harness's own driving necessarily moves.
 *
 * `simTime` accumulates on every driven frame and `pointer` mirrors the input
 * layer every update (`specs/instrumentation.md`), so a check that a key or a
 * press "changes nothing" would fail any build merely for running the frame
 * that delivered it. What "nothing" means is the game: the screen, the mode,
 * the menus, the progression, the board, the beams, and the trace.
 */
export function gameFields(s: RefractSnapshot): Record<string, unknown> {
  return {
    screen: s.screen,
    mode: s.mode,
    menuIndex: s.menuIndex,
    boardIndex: s.boardIndex,
    solvedBoards: s.solvedBoards,
    unlockedCount: s.unlockedCount,
    selectIndex: s.selectIndex,
    solvedCount: s.solvedCount,
    tier: s.tier,
    board: s.board,
    beams: s.beams,
    solved: s.solved,
    tracing: s.tracing,
  };
}
