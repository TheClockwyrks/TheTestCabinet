// The node field (specs/playfield.md, specs/charge.md). The board is a flat
// Int8Array of COLS*ROWS cells: -1 means "no node", otherwise the node's charge
// C in {0,1,2,3}. These are pure helpers over that array; the discharge chain and
// scoring live in game.ts because they also touch the worms and effects.

import {
  COLS,
  ROWS,
  SCATTER_TOP_ROW,
  SCATTER_BOTTOM_ROW,
  SCATTER_MIN_FRACTION,
  SCATTER_MAX_FRACTION,
  inBounds,
} from "./constants";
import type { Rng } from "./rng";

export const EMPTY = -1;

export const idx = (c: number, r: number): number => c + r * COLS;

export function chargeAt(field: Int8Array, c: number, r: number): number {
  if (!inBounds(c, r)) return EMPTY;
  return field[idx(c, r)];
}

export function hasNode(field: Int8Array, c: number, r: number): boolean {
  return chargeAt(field, c, r) >= 0;
}

export function setCharge(
  field: Int8Array,
  c: number,
  r: number,
  charge: number,
): void {
  if (inBounds(c, r)) field[idx(c, r)] = charge as number;
}

export function clearNode(field: Int8Array, c: number, r: number): void {
  if (inBounds(c, r)) field[idx(c, r)] = EMPTY;
}

// A fresh empty board.
export function emptyField(): Int8Array {
  const f = new Int8Array(COLS * ROWS);
  f.fill(EMPTY);
  return f;
}

// Scatter inert (C=0) nodes across rows 1..17 at 10%-15% of those tiles. Never
// row 0 (worm entry) and never the player band (specs/playfield.md).
export function scatterField(field: Int8Array, rng: Rng): void {
  const rows: number[] = [];
  for (let r = SCATTER_TOP_ROW; r <= SCATTER_BOTTOM_ROW; r++) rows.push(r);
  const tileCount = rows.length * COLS;
  const frac =
    SCATTER_MIN_FRACTION +
    rng.next() * (SCATTER_MAX_FRACTION - SCATTER_MIN_FRACTION);
  let target = Math.round(tileCount * frac);
  let guard = tileCount * 4;
  while (target > 0 && guard-- > 0) {
    const c = Math.floor(rng.next() * COLS);
    const r = rows[Math.floor(rng.next() * rows.length)];
    if (!hasNode(field, c, r)) {
      setCharge(field, c, r, 0);
      target--;
    }
  }
}

// How many nodes stand in the lower half of the board (rows 10..19). Drives the
// packet-dropper's sparse-field trigger (specs/foes.md).
export function lowerHalfNodeCount(field: Int8Array): number {
  let n = 0;
  for (let r = ROWS / 2; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) if (field[idx(c, r)] >= 0) n++;
  }
  return n;
}
