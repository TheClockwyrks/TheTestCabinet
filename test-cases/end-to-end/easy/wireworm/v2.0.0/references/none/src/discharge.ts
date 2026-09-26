// Wireworm — the chain-arc discharge (specs/discharge.md).
//
// A bolt into a critical node detonates it, and the detonation floods outward
// through the connected cluster of charged nodes around it. The whole chain
// resolves inside the update the bolt struck in, and the board it leaves behind
// is what the next update runs on.
//
// Two rules do most of the work and are worth stating here as well as in the
// spec, because they are what a wrong implementation gets wrong:
//
//   * An INERT node neither detonates nor conducts. The chain leaps over it, so
//     a charged node reachable only through one survives unless some other
//     detonated node also reaches it.
//   * A node detonates AT MOST ONCE. The flood is a breadth-first wave over a
//     visited set, so a node inside several blast radii is reached once and
//     emits its own links once — which is what makes the reported arc list a
//     faithful witness of the chain.

import {
  ARC_LIFE,
  CHARGE_MAX,
  CUES,
  DISCHARGE_RADIUS,
  SCORE_FRY,
  SCORE_PURGE_NODE,
  inBounds,
  tileCX,
  tileCY,
} from "./constants";
import { chargeAt, index, removeNode } from "./field";
import { randomFloat } from "./rng";
import { addScore } from "./scoring";
import type { CueSink, Point, Tile, WirewormState } from "./types";
import { removeSegments } from "./worm";

/** What one discharge did, for a caller that wants to report it. */
export interface DischargeResult {
  /** Every tile the chain detonated, in the order the wave reached them. */
  detonated: Tile[];
  /** One entry per conducted link. */
  links: { from: Tile; to: Tile }[];
  /** How many worm segments the discharge destroyed. */
  fried: number;
}

/** How many straight runs an arc's lightning is drawn in. */
const ARC_SEGMENTS = 4;

/** How far, in logical units, an arc's interior points stray from the straight line. */
const ARC_JITTER = 9;

/**
 * Detonate the node on `(c, r)` and run the chain from it.
 *
 * The whole flood is computed first and the nodes are removed afterwards, which
 * is equivalent — a node is detonated once, so nothing the flood reads changes
 * under it — and keeps the wave order readable.
 */
export function detonate(
  state: WirewormState,
  c: number,
  r: number,
  cues: CueSink,
): DischargeResult {
  const detonated: Tile[] = [];
  const links: { from: Tile; to: Tile }[] = [];
  const seen = new Set<number>([index(c, r)]);
  const queue: Tile[] = [{ c, r }];

  // Breadth-first, so every node the struck node reaches detonates before any
  // node those reach; within one node's arcs, ascending row and then column.
  while (queue.length > 0) {
    const from = queue.shift() as Tile;
    detonated.push(from);
    for (let dr = -DISCHARGE_RADIUS; dr <= DISCHARGE_RADIUS; dr += 1) {
      for (let dc = -DISCHARGE_RADIUS; dc <= DISCHARGE_RADIUS; dc += 1) {
        if (dc === 0 && dr === 0) continue;
        const nc = from.c + dc;
        const nr = from.r + dr;
        if (!inBounds(nc, nr)) continue;
        const at = index(nc, nr);
        if (seen.has(at)) continue;
        if (chargeAt(state.field, nc, nr) < 1) continue;
        seen.add(at);
        const to = { c: nc, r: nr };
        queue.push(to);
        links.push({ from: { c: from.c, r: from.r }, to });
      }
    }
  }

  for (const tile of detonated) {
    removeNode(state.field, tile.c, tile.r);
    addScore(state, SCORE_PURGE_NODE);
  }

  for (const link of links) {
    state.arcs.push({
      from: { c: link.from.c, r: link.from.r },
      to: { c: link.to.c, r: link.to.r },
      life: ARC_LIFE,
      shape: lightning(link.from, link.to),
    });
  }

  const fried = fryWorms(state, seen);
  cues.play(CUES.discharge);
  return { detonated, links, fried };
}

/**
 * Destroy every worm segment within `DISCHARGE_RADIUS` tiles of any detonated
 * node, and leave nothing on the tiles they stood on.
 *
 * The roster is iterated over a copy, because the runs a cut worm leaves are
 * appended to it as they are made.
 */
function fryWorms(
  state: WirewormState,
  detonated: ReadonlySet<number>,
): number {
  let fried = 0;
  for (const worm of [...state.worms]) {
    const keep = worm.segments.map(
      (segment) => !nearDetonated(detonated, segment),
    );
    const lost = keep.filter((kept) => !kept).length;
    if (lost === 0) continue;
    fried += lost;
    addScore(state, SCORE_FRY * lost);
    // A fried segment leaves nothing: no node is laid where it stood.
    removeSegments(state, worm, keep);
  }
  return fried;
}

/** Whether any detonated tile lies within the Chebyshev reach of `segment`. */
function nearDetonated(detonated: ReadonlySet<number>, segment: Tile): boolean {
  for (let dr = -DISCHARGE_RADIUS; dr <= DISCHARGE_RADIUS; dr += 1) {
    for (let dc = -DISCHARGE_RADIUS; dc <= DISCHARGE_RADIUS; dc += 1) {
      const c = segment.c + dc;
      const r = segment.r + dr;
      if (!inBounds(c, r)) continue;
      if (detonated.has(index(c, r))) return true;
    }
  }
  return false;
}

/**
 * The polyline one arc is drawn as: the straight line between two tile centers,
 * with its interior points thrown sideways.
 *
 * Every offset is drawn here, once, so the arc holds its shape for the whole of
 * its life.
 */
function lightning(from: Tile, to: Tile): Point[] {
  const x1 = tileCX(from.c);
  const y1 = tileCY(from.r);
  const x2 = tileCX(to.c);
  const y2 = tileCY(to.r);
  const nx = -(y2 - y1);
  const ny = x2 - x1;
  const length = Math.hypot(nx, ny) || 1;
  const points: Point[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
    const u = i / ARC_SEGMENTS;
    const stray =
      i === 0 || i === ARC_SEGMENTS
        ? 0
        : (randomFloat() - 0.5) * 2 * ARC_JITTER;
    points.push({
      x: x1 + (x2 - x1) * u + (nx / length) * stray,
      y: y1 + (y2 - y1) * u + (ny / length) * stray,
    });
  }
  return points;
}

/** Whether the node on `(c, r)` is critical, and so detonates when it is shot. */
export function isCritical(
  state: WirewormState,
  c: number,
  r: number,
): boolean {
  return chargeAt(state.field, c, r) >= CHARGE_MAX;
}
