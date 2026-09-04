// Wireworm — the node field (specs/nodes.md).
//
// The board is a flat `COLS * ROWS` array of charges: {@link EMPTY} for a tile
// holding no node, otherwise the node's charge in `0..CHARGE_MAX`. A dense array
// rather than a list of nodes, because every rule that reads the field reads a
// NEIGHBOURHOOD of it — the worm's block test looks at one tile, the discharge's
// flood at the 5x5 block around each node it detonates — and a dense array makes
// each of those a lookup instead of a search. `snapshot` turns it back into the
// list of standing nodes the debug surface reports.
//
// These are pure helpers over that array. What a bump, a bolt, a discharge or a
// foe DOES to a node lives with the rule that does it; nothing here decides
// anything.

import {
  CHARGE_MAX,
  COLS,
  ROWS,
  SCATTER_BOTTOM_ROW,
  SCATTER_MAX_FRACTION,
  SCATTER_MIN_FRACTION,
  SCATTER_TOP_ROW,
  inBounds,
} from "./constants";
import { nextFloat, type RngHolder } from "./rng";

/** The value a tile holding no node carries. */
export const EMPTY = -1;

/** The index of tile `(c, r)` in the flat field. */
export function index(c: number, r: number): number {
  return c + r * COLS;
}

/** A fresh board with no node on it. */
export function emptyField(): Int8Array {
  const field = new Int8Array(COLS * ROWS);
  field.fill(EMPTY);
  return field;
}

/** The charge of the node on `(c, r)`, or {@link EMPTY} for an empty or off-board tile. */
export function chargeAt(field: Int8Array, c: number, r: number): number {
  if (!inBounds(c, r)) return EMPTY;
  return field[index(c, r)];
}

/** Whether a node stands on `(c, r)`. */
export function hasNode(field: Int8Array, c: number, r: number): boolean {
  return chargeAt(field, c, r) >= 0;
}

/** Put a node of `charge` on `(c, r)`, creating it if the tile was empty. */
export function setCharge(
  field: Int8Array,
  c: number,
  r: number,
  charge: number,
): void {
  if (!inBounds(c, r)) return;
  field[index(c, r)] = Math.max(0, Math.min(CHARGE_MAX, Math.round(charge)));
}

/** Remove the node on `(c, r)`, leaving the tile empty. */
export function removeNode(field: Int8Array, c: number, r: number): void {
  if (inBounds(c, r)) field[index(c, r)] = EMPTY;
}

/** Remove every node from the board. */
export function clearNodes(field: Int8Array): void {
  field.fill(EMPTY);
}

/**
 * Lay the starting scatter: inert nodes on between `SCATTER_MIN_FRACTION` and
 * `SCATTER_MAX_FRACTION` of the tiles of rows `SCATTER_TOP_ROW..SCATTER_BOTTOM_ROW`.
 *
 * Every tile is drawn from the run's seeded generator, so two runs of one seed
 * lay the same field and two runs of different seeds do not. A tile already
 * carrying a node is re-drawn rather than counted twice, and the guard bounds
 * that retry loop: the target is at most 15% of the rows' tiles, so it is
 * reached long before the guard, and a guard that ran out would leave a slightly
 * sparser field rather than spinning.
 */
export function scatterField(field: Int8Array, rng: RngHolder): void {
  const rows = SCATTER_BOTTOM_ROW - SCATTER_TOP_ROW + 1;
  const tiles = rows * COLS;
  const fraction =
    SCATTER_MIN_FRACTION +
    nextFloat(rng) * (SCATTER_MAX_FRACTION - SCATTER_MIN_FRACTION);
  let remaining = Math.round(tiles * fraction);
  let guard = tiles * 8;
  while (remaining > 0 && guard > 0) {
    guard -= 1;
    const c = Math.floor(nextFloat(rng) * COLS);
    const r = SCATTER_TOP_ROW + Math.floor(nextFloat(rng) * rows);
    if (hasNode(field, c, r)) continue;
    setCharge(field, c, r, 0);
    remaining -= 1;
  }
}

/** How many nodes stand in rows `topRow..bottomRow`, both ends included. */
export function countNodes(
  field: Int8Array,
  topRow: number,
  bottomRow: number,
): number {
  let count = 0;
  for (
    let r = Math.max(0, topRow);
    r <= Math.min(ROWS - 1, bottomRow);
    r += 1
  ) {
    for (let c = 0; c < COLS; c += 1) {
      if (field[index(c, r)] >= 0) count += 1;
    }
  }
  return count;
}

/** One standing node, as the debug surface reports it. */
export interface NodeView {
  c: number;
  r: number;
  charge: number;
}

/** Every node on the board, ascending by row and then by column. */
export function listNodes(field: Int8Array): NodeView[] {
  const nodes: NodeView[] = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const charge = field[index(c, r)];
      if (charge >= 0) nodes.push({ c, r, charge });
    }
  }
  return nodes;
}
