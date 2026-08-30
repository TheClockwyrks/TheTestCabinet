// Wireworm — the bolts the cursor fires, and what each one resolves against
// (specs/cursor.md).
//
// A bolt climbs its column at `BOLT_SPEED` and resolves against the FIRST thing
// its center reaches — the lowest worm segment, node or foe above it. That is
// resolved by SWEEPING the interval the bolt covered this frame rather than by
// testing where it happened to land, and the difference matters: a bolt travels
// 900 units a second, and a frame long enough to cover a whole tile would
// otherwise carry it straight through a node without touching it. A swept bolt
// reaches the same verdict however the time was divided into frames, which is
// the property `specs/instrumentation.md` requires of the whole simulation.
//
// A bolt resolves against exactly one thing and leaves flight in the same
// update. Where a segment and a node share a tile the segment is what was
// struck, so the tie between two candidates entered at the same height goes to
// the foe, then the segment, then the node.

import {
  BOARD_Y,
  BOLT_SPEED,
  CHARGE_MAX,
  CUES,
  FOE_HALF,
  ROWS,
  SCORE_BODY,
  SCORE_CORRUPTOR,
  SCORE_DROPPER,
  SCORE_GLITCH,
  SCORE_HEAD,
  SCORE_INERT_NODE,
  TILE,
  DROPPER_SPEED_HIT,
  colAt,
  inBounds,
  rowAt,
  tileTop,
} from "./constants";
import { detonate } from "./discharge";
import { chargeAt, hasNode, removeNode, setCharge } from "./field";
import { checkLevelCleared } from "./progression";
import { addScore } from "./scoring";
import type { Bolt, CueSink, Foe, WirewormState, Worm } from "./types";
import { removeSegments } from "./worm";

/** What one bolt met on its way up this frame. */
type Strike =
  | { kind: "foe"; at: number; foe: Foe }
  | { kind: "segment"; at: number; worm: Worm; index: number }
  | { kind: "node"; at: number; c: number; r: number };

/** The order two candidates entered at the same height are resolved in. */
const PRIORITY = { foe: 3, segment: 2, node: 1 } as const;

/** Move every bolt, resolve what it struck, and drop the ones that are gone. */
export function updateBolts(
  state: WirewormState,
  dt: number,
  cues: CueSink,
): void {
  for (const bolt of [...state.bolts]) {
    // A bolt removed by an earlier bolt's discharge is no longer in flight.
    if (!state.bolts.includes(bolt)) continue;
    const from = bolt.y;
    const to = from - BOLT_SPEED * dt;
    const strike = firstStrike(state, bolt, from, to);
    if (strike !== null) {
      bolt.y = strike.at;
      consume(state, bolt);
      resolve(state, strike, cues);
      continue;
    }
    bolt.y = to;
    // Past the top of the board, it has left it.
    if (bolt.y < BOARD_Y) consume(state, bolt);
  }
}

/** Take one bolt out of flight. */
function consume(state: WirewormState, bolt: Bolt): void {
  const at = state.bolts.indexOf(bolt);
  if (at >= 0) state.bolts.splice(at, 1);
}

/**
 * The lowest thing the bolt's center passed through between `from` and `to`, or
 * `null` where the column was clear.
 */
function firstStrike(
  state: WirewormState,
  bolt: Bolt,
  from: number,
  to: number,
): Strike | null {
  let best: Strike | null = null;
  const take = (candidate: Strike): void => {
    if (best === null) {
      best = candidate;
      return;
    }
    if (candidate.at > best.at) best = candidate;
    else if (
      candidate.at === best.at &&
      PRIORITY[candidate.kind] > PRIORITY[best.kind]
    ) {
      best = candidate;
    }
  };

  const column = colAt(bolt.x);
  const top = Math.max(0, rowAt(to));
  const bottom = Math.min(ROWS - 1, rowAt(from));
  for (let r = top; r <= bottom; r += 1) {
    if (!inBounds(column, r)) continue;
    const tileBottom = tileTop(r) + TILE;
    if (tileTop(r) > from || tileBottom < to) continue;
    const at = Math.min(from, tileBottom);
    const worm = state.worms.find((candidate) =>
      candidate.segments.some(
        (segment) => segment.c === column && segment.r === r,
      ),
    );
    if (worm !== undefined) {
      const index = worm.segments.findIndex(
        (segment) => segment.c === column && segment.r === r,
      );
      take({ kind: "segment", at, worm, index });
    }
    if (hasNode(state.field, column, r)) {
      take({ kind: "node", at, c: column, r });
    }
  }

  for (const foe of state.foes) {
    if (Math.abs(foe.x - bolt.x) > FOE_HALF) continue;
    const boxTop = foe.y - FOE_HALF;
    const boxBottom = foe.y + FOE_HALF;
    if (boxTop > from || boxBottom < to) continue;
    take({ kind: "foe", at: Math.min(from, boxBottom), foe });
  }

  return best;
}

/** Apply what the strike does. */
function resolve(state: WirewormState, strike: Strike, cues: CueSink): void {
  switch (strike.kind) {
    case "node":
      hitNode(state, strike.c, strike.r, cues);
      return;
    case "segment":
      hitSegment(state, strike.worm, strike.index, cues);
      return;
    case "foe":
      hitFoe(state, strike.foe, cues);
      return;
  }
}

/**
 * What a bolt does to a node, by the charge it struck (specs/nodes.md): an inert
 * node is removed, a charged one is knocked down one level and left standing,
 * and a critical one detonates.
 */
export function hitNode(
  state: WirewormState,
  c: number,
  r: number,
  cues: CueSink,
): void {
  const charge = chargeAt(state.field, c, r);
  if (charge < 0) return;
  if (charge === 0) {
    removeNode(state.field, c, r);
    addScore(state, SCORE_INERT_NODE);
    return;
  }
  if (charge < CHARGE_MAX) {
    setCharge(state.field, c, r, charge - 1);
    return;
  }
  // A level clears on the step in which the last of its segments is REMOVED, so
  // the clear is checked only where the discharge actually destroyed one. A
  // detonation on a board carrying no worm is a shot at the terrain, not a clear.
  const discharge = detonate(state, c, r, cues);
  if (discharge.fried > 0) checkLevelCleared(state, cues);
}

/**
 * What a bolt does to a worm segment: the segment dies, leaving a fresh inert
 * node where it stood unless a node already stands there, and the worm shortens
 * or splits by the rule `specs/worm.md` states.
 */
export function hitSegment(
  state: WirewormState,
  worm: Worm,
  index: number,
  cues: CueSink,
): void {
  const segment = worm.segments[index];
  addScore(state, index === 0 ? SCORE_HEAD : SCORE_BODY);
  // The tile the segment died on takes a fresh inert node; a node already
  // standing there keeps the charge it had.
  if (!hasNode(state.field, segment.c, segment.r)) {
    setCharge(state.field, segment.c, segment.r, 0);
  }
  const keep = worm.segments.map((_, i) => i !== index);
  removeSegments(state, worm, keep);
  cues.play(CUES.cut);
  checkLevelCleared(state, cues);
}

/**
 * What a bolt does to a foe: a dropper's first bolt only marks it and speeds it
 * up, and every other hit destroys the foe and pays its bounty.
 */
export function hitFoe(state: WirewormState, foe: Foe, cues: CueSink): void {
  if (foe.kind === "dropper" && !foe.hit) {
    foe.hit = true;
    foe.vy = DROPPER_SPEED_HIT;
    return;
  }
  const at = state.foes.indexOf(foe);
  if (at >= 0) state.foes.splice(at, 1);
  addScore(state, bounty(foe.kind));
  cues.play(CUES.foe);
}

/** What each kind of foe pays (specs/scoring.md). */
function bounty(kind: Foe["kind"]): number {
  switch (kind) {
    case "glitch":
      return SCORE_GLITCH;
    case "dropper":
      return SCORE_DROPPER;
    case "corruptor":
      return SCORE_CORRUPTOR;
  }
}
