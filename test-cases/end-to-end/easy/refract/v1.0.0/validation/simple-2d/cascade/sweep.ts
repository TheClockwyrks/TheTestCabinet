// Refract — cascade/sweep: the shared sweep the cascade suites walk.
//
// PRIVATE to the cascade category. The harness's `solveGenerated` proves k
// boards solvable but hands back only the final snapshot; the suites here need
// to READ each board as it arrives (its shape, its tier row) and each solve as
// it lands (the tier after it), so this helper is the same loop with two
// hooks. Everything it does goes through the shared harness and the debug
// surface: the board is read off `snapshot`, the solution comes from the
// spec-derived `solver.ts`, the beams are drawn through `trace`, and NEXT
// BOARD is taken through the real `confirm` action on the solved menu
// (specs/modes/cascade.md: `menuIndex` is 0 on arriving at `solved`, and
// NEXT BOARD is the first of SOLVED_ITEMS).
//
// Documented residual risk (shared with `solveGenerated`): the solver is
// capped, so a `limit` verdict — the cap spent before an answer — is reported
// distinctly from `unsolvable`. Every board within the tier ladder's stated
// shapes resolves in milliseconds in practice; the cap is a runaway stop.

import { assertBetween, assertDeepEqual, assertEqual, fail } from "../assert";
import {
  oracleBoard,
  tapAction,
  traceBeams,
  type Harness,
  type RefractSnapshot,
} from "../harness";
import {
  CHANNELS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  MAX_CHARGES,
  channelsPresent,
  type Board,
} from "../notation";
import { solve } from "../solver";

export interface SweepHooks {
  /**
   * Called once per board while it is in play, before it is solved: the
   * snapshot the board arrived in, the playing frame already rendered, and
   * `round` counting boards from 1.
   */
  onBoard?: (snapshot: RefractSnapshot, round: number) => void;
  /**
   * Called once per solve, after the frame that draws the `solved` screen:
   * the snapshot on that screen, and `round` counting solves from 1.
   */
  onSolved?: (snapshot: RefractSnapshot, round: number) => void;
}

/**
 * Really solve `k` generated cascade boards in sequence, calling the hooks as
 * each board arrives and as each solve lands. Assumes a cascade in play
 * (`startCascade` after a `resetTo`). Returns the snapshot after the `k`-th
 * solve, on `solved`, with that screen's frame rendered.
 */
export async function sweepGenerated(
  h: Harness,
  k: number,
  hooks: SweepHooks = {},
): Promise<RefractSnapshot> {
  let snapshot = h.snapshot();
  for (let round = 1; round <= k; round += 1) {
    if (snapshot.screen === "solved") {
      await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
      snapshot = h.snapshot();
    }
    assertEqual(
      snapshot.screen,
      "playing",
      `sweep: cascade board ${round} in play (specs/modes/cascade.md)`,
    );
    hooks.onBoard?.(snapshot, round);
    const board = oracleBoard(snapshot);
    const result = solve(board);
    if (result.status !== "solved") {
      fail(
        "a solvable generated board (specs/modes/cascade.md: every board " +
          "the generator emits is solvable; the spec-derived solver " +
          `reported '${result.status}' after ${result.expansions} expansions)`,
        board,
      );
    }
    traceBeams(h, result.beams);
    snapshot = h.snapshot();
    assertEqual(
      snapshot.screen,
      "solved",
      `sweep: cascade board ${round} solved by the solver's beams ` +
        "(specs/beams.md R9)",
    );
    await h.advance(1);
    hooks.onSolved?.(h.snapshot(), round);
  }
  return h.snapshot();
}

/**
 * The generator's grid bound for one emitted board, as specs/modes/cascade.md
 * states it: within GRID_MAX_COLS x GRID_MAX_ROWS (7 x 6).
 */
export function assertFitsGrid(board: Board, context: string): void {
  assertBetween(board.cols, 1, GRID_MAX_COLS, `${context}: cols`);
  assertBetween(board.rows, 1, GRID_MAX_ROWS, `${context}: rows`);
}

/**
 * The generator's channel rows for one emitted board, as
 * specs/modes/cascade.md states them: the channels present are the first n of
 * CHANNELS, with exactly two emitters for each.
 */
export function assertTwoEmittersPerChannel(
  board: Board,
  context: string,
): void {
  const present = channelsPresent(board);
  assertDeepEqual(
    present,
    CHANNELS.slice(0, present.length),
    `${context}: the channels present are the first n of CHANNELS`,
  );
  for (const channel of present) {
    const emitters = board.nodes.filter(
      (node) => node.kind === "emitter" && node.channel === channel,
    ).length;
    assertEqual(
      emitters,
      2,
      `${context}: exactly two ${channel} emitters (specs/modes/cascade.md)`,
    );
  }
}

/**
 * The generator's charge ceiling for one emitted board, as
 * specs/modes/cascade.md states it: every crystal carries 1 to MAX_CHARGES (3)
 * charges, "never above MAX_CHARGES".
 */
export function assertCrystalChargesInRange(
  board: Board,
  context: string,
): void {
  for (const node of board.nodes) {
    if (node.kind !== "crystal") continue;
    assertBetween(
      node.charges ?? Number.NaN,
      1,
      MAX_CHARGES,
      `${context}: charges on the crystal at (${node.col}, ${node.row})`,
    );
  }
}
