// ruleset/drive.ts — private pointer helpers for the ruleset suites.
//
// Every ruleset check poses a live trace and then attempts one violating move,
// so what it needs beyond the shared harness is a press and a move addressed by
// CELL rather than by stage position — the surface's own `pointerDown` and
// `pointerMove`, aimed at a cell center through the formula in `specs/board.md`.
// The shared `traceCells` will not do here: it releases at the end, and a
// refusal is only observable while the trace it leaves live is still live.
//
// These helpers only ARRANGE. Neither asserts anything: the verdict — the beam
// unchanged, the trace still live — is read and judged in the suite that posed
// the move.

import { center, type Harness } from "../harness";
import type { Board } from "../notation";
import type { Cell } from "../rules";

/** Press the surface's pointer at a cell's center, resolved immediately. */
export async function pressAt(
  h: Harness,
  board: Pick<Board, "cols" | "rows">,
  cell: Cell,
): Promise<void> {
  const at = center(board, cell);
  await h.debug.pointerDown(at.x, at.y);
}

/** Move the surface's pointer over a cell's center, resolved immediately. */
export async function moveOver(
  h: Harness,
  board: Pick<Board, "cols" | "rows">,
  cell: Cell,
): Promise<void> {
  const at = center(board, cell);
  await h.debug.pointerMove(at.x, at.y);
}
