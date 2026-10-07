// Wireworm — the chain-arc discharge (`specs/discharge.md`).
//
// A bolt into a critical node detonates it, and the whole chain resolves inside
// the update that struck it: the board the next update runs on is the one the
// discharge left. The chain floods outward one wave at a time through the
// connected cluster of charged nodes, an inert node neither detonating nor
// conducting, and every worm segment within the reach of any node it detonated
// is destroyed and leaves nothing behind.
//
// What the discharge REPORTS is the set of links it conducted along, one entry
// per node beyond the struck one, each naming the two tiles it joined. That set
// is what the chain rule fixes, so it is state and it lasts `ARC_LIFE`. How a
// link is DRAWN is this build's own design and lives in `src/render.ts`; its
// shape is fixed when the arc is created, and the jitter that shapes it is a
// function of the tiles it joins, so a discharge reads as one bolt fading
// rather than as static.

import {
  ARC_LIFE,
  COLS,
  CUES,
  DISCHARGE_RADIUS,
  inBounds,
  SCORE_FRY,
  SCORE_PURGE_NODE,
} from "./constants";
import { addScore } from "./scoring";
import { splitWorm } from "./worm";
import type { FrameEvents, MutArc, MutNode, Sim } from "./sim";

/** The Chebyshev distance between two tiles, which is what the reach is measured in. */
function chebyshev(ac: number, ar: number, bc: number, br: number): number {
  return Math.max(Math.abs(ac - bc), Math.abs(ar - br));
}

/** The reading-order key a node is found by while the chain runs. */
function key(c: number, r: number): number {
  return r * COLS + c;
}

/**
 * Detonate the node on `(c, r)` and run the chain out from it.
 *
 * The caller has already established that the node is standing and critical.
 */
export function detonate(
  sim: Sim,
  c: number,
  r: number,
  ev: FrameEvents,
): void {
  const standing = new Map<number, MutNode>();
  for (const node of sim.nodes) standing.set(key(node.c, node.r), node);

  const struck = standing.get(key(c, r));
  if (struck === undefined) return;

  // A node is detonated at most once, so it is marked as it joins the wave
  // front rather than as it is taken off it: each node beyond the struck one
  // therefore carries exactly one incoming link.
  const detonated: MutNode[] = [struck];
  const seen = new Set<number>([key(c, r)]);
  const links: MutArc[] = [];

  for (let head = 0; head < detonated.length; head++) {
    const from = detonated[head] as MutNode;
    // Within one node's arcs the nodes it reaches are taken in ascending row,
    // then ascending column.
    for (let dr = -DISCHARGE_RADIUS; dr <= DISCHARGE_RADIUS; dr++) {
      for (let dc = -DISCHARGE_RADIUS; dc <= DISCHARGE_RADIUS; dc++) {
        const nc = from.c + dc;
        const nr = from.r + dr;
        if (!inBounds(nc, nr)) continue;
        const k = key(nc, nr);
        if (seen.has(k)) continue;
        const node = standing.get(k);
        if (node === undefined || node.charge < 1) continue;
        seen.add(k);
        detonated.push(node);
        links.push({
          from: { c: from.c, r: from.r },
          to: { c: nc, r: nr },
          life: ARC_LIFE,
        });
      }
    }
  }

  const removed = new Set(detonated.map((node) => key(node.c, node.r)));
  sim.nodes = sim.nodes.filter((node) => !removed.has(key(node.c, node.r)));
  addScore(sim, SCORE_PURGE_NODE * detonated.length);

  // Every segment within the reach of any detonated node is destroyed, and
  // leaves nothing on the tile it stood on.
  let fried = 0;
  for (const worm of [...sim.worms]) {
    const doomed = new Set<number>();
    worm.segments.forEach((tile, index) => {
      const caught = detonated.some(
        (node) => chebyshev(tile.c, tile.r, node.c, node.r) <= DISCHARGE_RADIUS,
      );
      if (caught) doomed.add(index);
    });
    if (doomed.size === 0) continue;
    fried += doomed.size;
    splitWorm(sim, worm, doomed);
  }
  if (fried > 0) {
    addScore(sim, SCORE_FRY * fried);
    ev.segmentsRemoved += fried;
  }

  sim.arcs.push(...links);
  ev.cues.add(CUES.discharge);
}

/** Age every live arc by `dt`, dropping the ones whose life has run out. */
export function ageArcs(sim: Sim, dt: number): void {
  for (const arc of sim.arcs) arc.life -= dt;
  sim.arcs = sim.arcs.filter((arc) => arc.life > 0);
}
