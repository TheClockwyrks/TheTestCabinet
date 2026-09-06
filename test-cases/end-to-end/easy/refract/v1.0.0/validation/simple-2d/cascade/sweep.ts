// Refract — cascade/sweep: readings shared by this category's suites.
//
// PRIVATE to the cascade category. Everything here is derived from the specs
// alone: the generator's contract from specs/modes/cascade.md, read off a
// board the harness's `generateAtTiers` asked the generator for or the game
// dealt on NEXT BOARD. Nothing poses; each helper reads a board and asserts
// one clause a suite in this directory names.

import { assertBetween, assertDeepEqual, assertEqual } from "../assert";
import {
  CHANNELS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  MAX_CHARGES,
  channelsPresent,
  type Board,
} from "../notation";

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
