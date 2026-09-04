// Wireworm — the board as a data structure: what stands on a tile, and how a
// position on the stage names one.
//
// The geometry itself is `src/constants.ts` — `tileLeft`, `tileTop`, `tileCX`,
// `tileCY` and `inBounds` are the map `specs/board.md` fixes, and nothing here
// derives it a second time. What this module adds is the lookups every rule
// asks: the node standing on a tile, the segment standing on a tile, and the
// inverse map a center is read through.
//
// The node roster is kept in ascending row, then ascending column, which is the
// order `specs/state.md` declares and the order the snapshot reports. Insertion
// keeps it that way, so nothing sorts at the call.

import { BOARD_Y, TILE, inBounds } from "./constants";
import type { NodeState, WirewormState, WormState } from "./game";

/** The tile column a stage `x` falls in, per the inverse map in specs/board.md. */
export function tileColumn(x: number): number {
  return Math.floor(x / TILE);
}

/** The tile row a stage `y` falls in, per the inverse map in specs/board.md. */
export function tileRow(y: number): number {
  return Math.floor((y - BOARD_Y) / TILE);
}

/** Where tile `(c, r)` sits in the roster's order, or where it would go. */
function insertionPoint(nodes: readonly NodeState[], c: number, r: number) {
  let low = 0;
  let high = nodes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const node = nodes[mid];
    if (node.r < r || (node.r === r && node.c < c)) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The index of the node on tile `(c, r)`, or `-1` where the tile is empty. */
export function nodeIndexAt(
  nodes: readonly NodeState[],
  c: number,
  r: number,
): number {
  const at = insertionPoint(nodes, c, r);
  const node = nodes[at];
  return node !== undefined && node.c === c && node.r === r ? at : -1;
}

/** The node on tile `(c, r)`, or `null` where the tile is empty. */
export function nodeAt(
  nodes: readonly NodeState[],
  c: number,
  r: number,
): NodeState | null {
  const at = nodeIndexAt(nodes, c, r);
  return at === -1 ? null : nodes[at];
}

/**
 * Put a node of `charge` on tile `(c, r)`, creating it where the tile was empty
 * and keeping the roster in row-then-column order. A tile off the board takes
 * nothing. Returns the node, or `null` for a tile off the board.
 */
export function putNode(
  state: WirewormState,
  c: number,
  r: number,
  charge: number,
): NodeState | null {
  if (!inBounds(c, r)) return null;
  const at = insertionPoint(state.nodes, c, r);
  const found = state.nodes[at];
  if (found !== undefined && found.c === c && found.r === r) {
    found.charge = charge;
    return found;
  }
  const node: NodeState = { c, r, charge };
  state.nodes.splice(at, 0, node);
  return node;
}

/** Remove the node on tile `(c, r)`. Returns whether one stood there. */
export function dropNode(state: WirewormState, c: number, r: number): boolean {
  const at = nodeIndexAt(state.nodes, c, r);
  if (at === -1) return false;
  state.nodes.splice(at, 1);
  return true;
}

/** One worm segment, named by the worm it belongs to and its place in the chain. */
export interface SegmentRef {
  worm: WormState;
  index: number;
}

/**
 * The worm segment standing on tile `(c, r)`, of any worm, or `null`. The
 * rosters are small — a level's worm is 10 to 32 segments — so the walk is the
 * whole of it.
 */
export function segmentAt(
  worms: readonly WormState[],
  c: number,
  r: number,
): SegmentRef | null {
  for (const worm of worms) {
    for (let index = 0; index < worm.segments.length; index += 1) {
      const segment = worm.segments[index];
      if (segment.c === c && segment.r === r) return { worm, index };
    }
  }
  return null;
}

/** The Chebyshev distance between two tiles, which is what a discharge reaches by. */
export function chebyshev(
  ac: number,
  ar: number,
  bc: number,
  br: number,
): number {
  return Math.max(Math.abs(ac - bc), Math.abs(ar - br));
}
