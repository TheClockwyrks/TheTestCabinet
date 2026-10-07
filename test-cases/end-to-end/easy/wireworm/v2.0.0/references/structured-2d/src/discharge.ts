// Wireworm — the chain-arc discharge (`specs/discharge.md`).
//
// A bolt into a critical node detonates it, and the whole chain resolves at that
// moment, inside the same update: the board it leaves behind is what the next
// update runs on. The chain runs outward one WAVE at a time — every node the
// struck node reaches detonates before any node those nodes reach — and within
// one node's arcs the nodes it reaches are taken in ascending row, then
// ascending column, which is the order the node roster is already kept in.
//
// A detonated node is removed as it detonates, so "every node at charge 1 or
// above that is STANDING AT THAT MOMENT" and "a node is detonated at most once
// per discharge" are the same rule read twice, and neither needs a visited set.
// An inert node is neither detonated nor removed and does not conduct: the chain
// leaps over it.
//
// What the discharge REPORTS is the set of links it conducted along, one per
// node beyond the struck one, each naming the tile that detonated it and the
// tile it stood on. That set is state (`specs/instrumentation.md`); the lightning
// drawn along a link is appearance (`src/render.ts`).

import {
  ARC_LIFE,
  DISCHARGE_RADIUS,
  SCORE_FRY,
  SCORE_PURGE_NODE,
} from "./constants";
import type { FrameCues } from "./audio";
import type { Tile, WirewormState } from "./game";
import { chebyshev, dropNode } from "./grid";
import { addScore } from "./scoring";
import { cutWorm } from "./worm";

/** Every charged node standing within reach of `tile`, in roster order. */
function reachedFrom(state: WirewormState, tile: Tile): Tile[] {
  const reached: Tile[] = [];
  for (const node of state.nodes) {
    if (node.charge < 1) continue;
    if (chebyshev(node.c, node.r, tile.c, tile.r) > DISCHARGE_RADIUS) continue;
    reached.push({ c: node.c, r: node.r });
  }
  return reached;
}

/**
 * Detonate the node on tile `(c, r)` and run the chain out from it. Returns how
 * many worm segments the discharge destroyed, which is what tells the update
 * whether this was the removal that cleared the level.
 *
 * The caller has already established that a critical node stands there.
 */
export function detonate(
  state: WirewormState,
  c: number,
  r: number,
  cues: FrameCues,
): number {
  cues.discharge = true;

  const detonated: Tile[] = [{ c, r }];
  dropNode(state, c, r);

  let frontier: Tile[] = [{ c, r }];
  while (frontier.length > 0) {
    const next: Tile[] = [];
    for (const tile of frontier) {
      for (const target of reachedFrom(state, tile)) {
        // Standing when the wave reaches it, so removing it here is what keeps
        // any later reach from detonating it a second time.
        dropNode(state, target.c, target.r);
        state.arcs.push({
          from: { c: tile.c, r: tile.r },
          to: { c: target.c, r: target.r },
          life: ARC_LIFE,
        });
        detonated.push(target);
        next.push(target);
      }
    }
    frontier = next;
  }

  addScore(state, SCORE_PURGE_NODE * detonated.length);
  return fryWorms(state, detonated);
}

/**
 * Destroy every worm segment within `DISCHARGE_RADIUS` tiles of any node the
 * discharge detonated. A segment destroyed this way leaves nothing behind, and
 * the survivors fall into worms by the rule `specs/worm.md` states.
 */
function fryWorms(state: WirewormState, detonated: readonly Tile[]): number {
  let fried = 0;
  for (const worm of [...state.worms]) {
    const removed = new Set<number>();
    for (let index = 0; index < worm.segments.length; index += 1) {
      const segment = worm.segments[index];
      const caught = detonated.some(
        (tile) =>
          chebyshev(segment.c, segment.r, tile.c, tile.r) <= DISCHARGE_RADIUS,
      );
      if (caught) removed.add(index);
    }
    if (removed.size === 0) continue;
    fried += removed.size;
    cutWorm(state, worm, removed);
  }
  if (fried > 0) addScore(state, SCORE_FRY * fried);
  return fried;
}

/** Age every live arc by `dt`, dropping the ones whose life has run out. */
export function advanceArcs(state: WirewormState, dt: number): void {
  if (state.arcs.length === 0) return;
  for (const arc of state.arcs) arc.life -= dt;
  state.arcs = state.arcs.filter((arc) => arc.life > 0);
}
