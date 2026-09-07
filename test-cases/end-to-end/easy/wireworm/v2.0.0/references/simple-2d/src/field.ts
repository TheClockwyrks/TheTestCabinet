// Wireworm — the node field (`specs/nodes.md`).
//
// A tile is either empty or holds exactly one node, and a node's whole state is
// its charge. `WirewormState.nodes` lists them in ascending row, then ascending
// column, and every route that adds one restores that order, so the snapshot's
// promise about the order is a property of the field rather than something the
// snapshot arranges on the way out.

import {
  BOARD_Y,
  CHARGE_MAX,
  COLS,
  CUES,
  SCATTER_BOTTOM_ROW,
  SCATTER_MAX_FRACTION,
  SCATTER_MIN_FRACTION,
  SCATTER_TOP_ROW,
  TILE,
} from "./constants";
import { randomInt } from "./rng";
import type { FrameEvents, MutNode, Sim } from "./sim";

/** The reading order the field is kept in: ascending row, then column. */
function order(node: MutNode): number {
  return node.r * COLS + node.c;
}

/** Put the field back into reading order. */
export function sortNodes(nodes: MutNode[]): void {
  nodes.sort((a, b) => order(a) - order(b));
}

/** The node standing on `(c, r)`, or `undefined` where the tile is empty. */
export function nodeAt(sim: Sim, c: number, r: number): MutNode | undefined {
  return sim.nodes.find((node) => node.c === c && node.r === r);
}

/** Whether a node stands on `(c, r)`. */
export function hasNode(sim: Sim, c: number, r: number): boolean {
  return nodeAt(sim, c, r) !== undefined;
}

/**
 * Set the node on `(c, r)` to `charge`, creating it where the tile was empty.
 * The charge is held to a whole number in `[0, CHARGE_MAX]`.
 */
export function putNode(
  sim: Sim,
  c: number,
  r: number,
  charge: number,
): MutNode {
  const held = Math.max(0, Math.min(CHARGE_MAX, Math.round(charge)));
  const standing = nodeAt(sim, c, r);
  if (standing !== undefined) {
    standing.charge = held;
    return standing;
  }
  const node: MutNode = { c, r, charge: held };
  sim.nodes.push(node);
  sortNodes(sim.nodes);
  return node;
}

/** Remove the node on `(c, r)`. Reports whether one stood there. */
export function dropNode(sim: Sim, c: number, r: number): boolean {
  const index = sim.nodes.findIndex((node) => node.c === c && node.r === r);
  if (index < 0) return false;
  sim.nodes.splice(index, 1);
  return true;
}

/**
 * The rise a block deals: one charge, capped at `CHARGE_MAX`
 * (`specs/nodes.md`). A node that reaches critical raises the `critical` cue.
 */
export function bumpNode(node: MutNode, ev: FrameEvents): void {
  if (node.charge >= CHARGE_MAX) return;
  node.charge += 1;
  if (node.charge === CHARGE_MAX) ev.cues.add(CUES.critical);
}

/**
 * The corruptor's slam: straight to `CHARGE_MAX`, whatever the node held
 * (`specs/foes.md`). A node already critical is left alone, so nothing sounds.
 */
export function slamNode(node: MutNode, ev: FrameEvents): void {
  if (node.charge >= CHARGE_MAX) return;
  node.charge = CHARGE_MAX;
  ev.cues.add(CUES.critical);
}

/** How many tiles the scatter rows hold between them. */
export const SCATTER_TILES = COLS * (SCATTER_BOTTOM_ROW - SCATTER_TOP_ROW + 1);

/**
 * Lay the starting field (`specs/nodes.md`): a scatter of inert nodes across
 * rows `SCATTER_TOP_ROW..SCATTER_BOTTOM_ROW`, covering between
 * `SCATTER_MIN_FRACTION` and `SCATTER_MAX_FRACTION` of those tiles, each tile
 * drawn at random so two runs lay different fields.
 */
export function scatterField(sim: Sim): void {
  sim.nodes = [];
  const wanted = randomInt(
    Math.round(SCATTER_MIN_FRACTION * SCATTER_TILES),
    Math.round(SCATTER_MAX_FRACTION * SCATTER_TILES),
  );
  const taken = new Set<number>();
  // Bounded by construction: the tiles wanted are at most 15% of the rows, so
  // the draw runs out of fresh tiles long before it runs out of attempts.
  let attempts = 0;
  const limit = SCATTER_TILES * 8;
  while (taken.size < wanted && attempts < limit) {
    attempts += 1;
    const c = randomInt(0, COLS - 1);
    const r = randomInt(SCATTER_TOP_ROW, SCATTER_BOTTOM_ROW);
    taken.add(r * COLS + c);
  }

  sim.nodes = [...taken]
    .sort((a, b) => a - b)
    .map((key) => ({ c: key % COLS, r: Math.floor(key / COLS), charge: 0 }));
}

/** The tile a stage position falls in, whether or not it lies on the board. */
export function tileOf(x: number, y: number): { c: number; r: number } {
  return {
    c: Math.floor(x / TILE),
    r: Math.floor((y - BOARD_Y) / TILE),
  };
}
