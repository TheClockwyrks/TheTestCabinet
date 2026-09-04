// Wireworm — a bolt in flight, and what it resolves against (`specs/cursor.md`).
//
// A bolt travels straight up at `BOLT_SPEED`, integrated against the frame's
// delta, and resolves against the FIRST thing its center reaches. "First" is
// read along the path the bolt swept this frame rather than at the point it
// ended on: at 900 units per second a frame of a tenth of a second carries a
// bolt across nearly three tiles, and a bolt that passed through a node has
// struck it. So each candidate is given the `y` at which the bolt's center first
// entered it, and the candidate with the LOWEST entry — the largest `y` — is the
// one struck. Where a worm segment and a node share a tile the entry heights are
// equal, and the segment wins, which is the rule that file states outright.
//
// A bolt resolves against exactly one thing and leaves flight in the same
// update; a bolt that reaches the top of the board without resolving is gone.

import {
  BOARD_Y,
  BOLT_SPEED,
  CHARGE_MAX,
  DROPPER_SPEED_HIT,
  FOE_HALF,
  SCORE_BODY,
  SCORE_CORRUPTOR,
  SCORE_DROPPER,
  SCORE_GLITCH,
  SCORE_HEAD,
  SCORE_INERT_NODE,
  TILE,
  tileTop,
} from "./constants";
import type { FrameCues } from "./audio";
import type { BoltState, WirewormState } from "./game";
import { detonate } from "./discharge";
import { dropNode, nodeAt, putNode, segmentAt, tileColumn } from "./grid";
import { addScore } from "./scoring";
import { cutWorm } from "./worm";

/** A bolt in flight at `(x, y)`, appended to the roster with the next free id. */
export function addBoltTo(
  state: WirewormState,
  x: number,
  y: number,
): BoltState {
  const bolt: BoltState = { id: state.nextId, x, y };
  state.nextId += 1;
  state.bolts.push(bolt);
  return bolt;
}

/** What a bolt struck, and the height at which it first reached it. */
interface Hit {
  entry: number;
  kind: "segment" | "node" | "foe";
  c: number;
  r: number;
  foeId: number;
}

/**
 * The highest-priority thing the bolt reached sweeping from `top` up to
 * `bottom`, or `null` where it reached nothing. A tie between a segment and a
 * node on one tile is settled in the segment's favour.
 */
function firstHit(
  state: WirewormState,
  x: number,
  bottom: number,
  top: number,
): Hit | null {
  const column = tileColumn(x);
  let best: Hit | null = null;
  const consider = (hit: Hit): void => {
    if (best === null || hit.entry > best.entry) best = hit;
  };
  // A shade under the tile's own bottom edge, which belongs to the tile below.
  const insideTile = (r: number): number => tileTop(r) + TILE - 1e-9;

  for (const worm of state.worms) {
    for (const segment of worm.segments) {
      if (segment.c !== column) continue;
      const tileBottom = tileTop(segment.r) + TILE;
      if (bottom < tileTop(segment.r) || top >= tileBottom) continue;
      consider({
        entry: Math.min(bottom, insideTile(segment.r)),
        kind: "segment",
        c: segment.c,
        r: segment.r,
        foeId: 0,
      });
    }
  }

  for (const node of state.nodes) {
    if (node.c !== column) continue;
    const tileBottom = tileTop(node.r) + TILE;
    if (bottom < tileTop(node.r) || top >= tileBottom) continue;
    // A segment on the same tile was reached at the same height and was
    // considered first, and `consider` only replaces on a strictly greater
    // entry, so the segment keeps the strike exactly as specs/cursor.md says.
    consider({
      entry: Math.min(bottom, insideTile(node.r)),
      kind: "node",
      c: node.c,
      r: node.r,
      foeId: 0,
    });
  }

  for (const foe of state.foes) {
    if (Math.abs(foe.x - x) > FOE_HALF) continue;
    if (bottom < foe.y - FOE_HALF || top > foe.y + FOE_HALF) continue;
    consider({
      entry: Math.min(bottom, foe.y + FOE_HALF),
      kind: "foe",
      c: 0,
      r: 0,
      foeId: foe.id,
    });
  }

  return best;
}

/**
 * Move every bolt and resolve the ones that reached something. Returns how many
 * worm segments the bolts destroyed, directly or through a discharge, which is
 * what tells the update whether this was the removal that cleared the level.
 */
export function advanceBolts(
  state: WirewormState,
  dt: number,
  cues: FrameCues,
): number {
  if (state.bolts.length === 0) return 0;
  let removed = 0;
  const surviving: BoltState[] = [];

  for (const bolt of state.bolts) {
    const bottom = bolt.y;
    const top = bolt.y - BOLT_SPEED * dt;
    const hit = firstHit(state, bolt.x, bottom, top);
    if (hit !== null) {
      removed += resolveHit(state, hit, cues);
      continue;
    }
    bolt.y = top;
    // Its center has left the board through the top: it is gone.
    if (bolt.y >= BOARD_Y) surviving.push(bolt);
  }

  state.bolts = surviving;
  return removed;
}

/** Apply what the bolt struck. Returns the worm segments the strike removed. */
function resolveHit(state: WirewormState, hit: Hit, cues: FrameCues): number {
  switch (hit.kind) {
    case "segment":
      return strikeSegment(state, hit.c, hit.r, cues);
    case "node":
      return strikeNode(state, hit.c, hit.r, cues);
    case "foe":
      strikeFoe(state, hit.foeId, cues);
      return 0;
  }
}

/**
 * A bolt into a worm segment: the segment dies, the worm is cut by the rule
 * `specs/worm.md` states, and a fresh inert node is left on the tile it died on
 * unless a node already stands there (`specs/nodes.md`).
 */
function strikeSegment(
  state: WirewormState,
  c: number,
  r: number,
  cues: FrameCues,
): number {
  const found = segmentAt(state.worms, c, r);
  if (found === null) return 0;
  cues.cut = true;
  addScore(state, found.index === 0 ? SCORE_HEAD : SCORE_BODY);
  cutWorm(state, found.worm, new Set([found.index]));
  if (nodeAt(state.nodes, c, r) === null) putNode(state, c, r, 0);
  return 1;
}

/** A bolt into a node, by the charge it was standing at (`specs/nodes.md`). */
function strikeNode(
  state: WirewormState,
  c: number,
  r: number,
  cues: FrameCues,
): number {
  const node = nodeAt(state.nodes, c, r);
  if (node === null) return 0;
  if (node.charge >= CHARGE_MAX) return detonate(state, c, r, cues);
  if (node.charge === 0) {
    dropNode(state, c, r);
    addScore(state, SCORE_INERT_NODE);
    return 0;
  }
  node.charge -= 1;
  return 0;
}

/** A bolt into a foe, by the kind it is (`specs/foes.md`). */
function strikeFoe(state: WirewormState, id: number, cues: FrameCues): void {
  const at = state.foes.findIndex((foe) => foe.id === id);
  if (at === -1) return;
  const foe = state.foes[at];
  if (foe.kind === "dropper" && !foe.hit) {
    // The first bolt does not destroy it: it speeds the rest of the fall.
    foe.hit = true;
    foe.vy = DROPPER_SPEED_HIT;
    return;
  }
  state.foes.splice(at, 1);
  cues.foe = true;
  addScore(
    state,
    foe.kind === "glitch"
      ? SCORE_GLITCH
      : foe.kind === "dropper"
        ? SCORE_DROPPER
        : SCORE_CORRUPTOR,
  );
}
