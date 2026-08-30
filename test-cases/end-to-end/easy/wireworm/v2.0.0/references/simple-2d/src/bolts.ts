// Wireworm — the cursor's bolts: firing them, flying them, and resolving what
// they strike (`specs/cursor.md`, `specs/nodes.md`, `specs/foes.md`).
//
// A bolt climbs its column and resolves against the first thing its center
// reaches, which is the LOWEST worm segment, node or foe standing above it. The
// resolution is swept rather than sampled: the frame's travel is the interval
// from `y0` up to `y1`, and a candidate is reached at the largest `y` in that
// interval at which the bolt's center is inside it. A frame long enough to carry
// the bolt through several tiles therefore resolves against the first of them
// rather than through all of them, which is what keeps the simulation reading
// the same however the elapsed time was divided into frames.

import {
  BOARD_Y,
  BOLT_SPEED,
  CHARGE_MAX,
  CUES,
  CURSOR_HALF,
  DROPPER_SPEED_HIT,
  FIRE_INTERVAL,
  FOE_HALF,
  MAX_BOLTS,
  SCORE_BODY,
  SCORE_CORRUPTOR,
  SCORE_DROPPER,
  SCORE_GLITCH,
  SCORE_HEAD,
  SCORE_INERT_NODE,
  TILE,
  tileTop,
} from "./constants";
import { detonate } from "./discharge";
import { dropNode, hasNode, nodeAt, putNode } from "./field";
import { addScore } from "./scoring";
import { splitWorm } from "./worm";
import { takeId, type FrameEvents, type MutBolt, type Sim } from "./sim";

/** What a bolt found in its path, and how far up this frame's travel it is. */
interface Strike {
  /** The largest `y` of the frame's travel at which the bolt was inside it. */
  readonly at: number;
  /** Segment before node before foe, which is what settles a shared tile. */
  readonly rank: number;
  /** What the bolt struck, run once the bolt has been taken out of flight. */
  readonly resolve: (sim: Sim, ev: FrameEvents) => void;
}

/**
 * The `y` at which a bolt travelling from `y0` up to `y1` first enters the
 * interval `[lo, hi]`, or `null` where it never enters it.
 */
function reachedAt(
  y0: number,
  y1: number,
  lo: number,
  hi: number,
): number | null {
  if (y1 > hi || y0 < lo) return null;
  return Math.min(y0, hi);
}

/** Fire while the action is held, the cooldown rests and the cap allows one more. */
export function fireBolts(
  sim: Sim,
  held: boolean,
  dt: number,
  ev: FrameEvents,
): void {
  sim.fireCooldown = Math.max(0, sim.fireCooldown - dt);
  if (!held) return;
  if (sim.fireCooldown > 0) return;
  if (sim.bolts.length >= MAX_BOLTS) return;

  sim.bolts.push({
    id: takeId(sim),
    x: sim.cursor.x,
    y: sim.cursor.y - CURSOR_HALF,
  });
  sim.fireCooldown = FIRE_INTERVAL;
  ev.cues.add(CUES.fire);
}

/** A bolt into a node, by the charge it struck (`specs/nodes.md`). */
function strikeNode(sim: Sim, c: number, r: number, ev: FrameEvents): void {
  const node = nodeAt(sim, c, r);
  if (node === undefined) return;
  if (node.charge >= CHARGE_MAX) {
    detonate(sim, c, r, ev);
    return;
  }
  if (node.charge === 0) {
    dropNode(sim, c, r);
    addScore(sim, SCORE_INERT_NODE);
    return;
  }
  node.charge -= 1;
}

/** A bolt into a foe, by its kind (`specs/foes.md`). */
function strikeFoe(sim: Sim, id: number, ev: FrameEvents): void {
  const index = sim.foes.findIndex((foe) => foe.id === id);
  const foe = sim.foes[index];
  if (foe === undefined) return;

  if (foe.kind === "dropper" && !foe.hit) {
    // The first bolt only wakes it: from here it falls at its hit speed.
    foe.hit = true;
    foe.vy = DROPPER_SPEED_HIT;
    return;
  }

  sim.foes.splice(index, 1);
  const bounty =
    foe.kind === "glitch"
      ? SCORE_GLITCH
      : foe.kind === "dropper"
        ? SCORE_DROPPER
        : SCORE_CORRUPTOR;
  addScore(sim, bounty);
  ev.cues.add(CUES.foe);
}

/** A bolt into a worm segment (`specs/worm.md`, `specs/nodes.md`). */
function strikeSegment(
  sim: Sim,
  wormId: number,
  index: number,
  ev: FrameEvents,
): void {
  const worm = sim.worms.find((candidate) => candidate.id === wormId);
  const tile = worm?.segments[index];
  if (worm === undefined || tile === undefined) return;

  addScore(sim, index === 0 ? SCORE_HEAD : SCORE_BODY);
  // The field grows from what the gun kills: a fresh inert node, unless the
  // tile already holds one, which keeps the charge it had.
  if (!hasNode(sim, tile.c, tile.r)) putNode(sim, tile.c, tile.r, 0);
  splitWorm(sim, worm, new Set([index]));
  ev.segmentsRemoved += 1;
  ev.cues.add(CUES.cut);
}

/** Everything the bolt could reach on this frame's travel, in its own column. */
function strikes(sim: Sim, bolt: MutBolt, y1: number): Strike[] {
  const found: Strike[] = [];
  const column = Math.floor(bolt.x / TILE);

  for (const worm of sim.worms) {
    const wormId = worm.id;
    worm.segments.forEach((tile, index) => {
      if (tile.c !== column) return;
      const top = tileTop(tile.r);
      const at = reachedAt(bolt.y, y1, top, top + TILE);
      if (at === null) return;
      found.push({
        at,
        rank: 0,
        resolve: (s, e) => strikeSegment(s, wormId, index, e),
      });
    });
  }

  for (const node of sim.nodes) {
    if (node.c !== column) continue;
    const top = tileTop(node.r);
    const at = reachedAt(bolt.y, y1, top, top + TILE);
    if (at === null) continue;
    const { c, r } = node;
    found.push({ at, rank: 1, resolve: (s, e) => strikeNode(s, c, r, e) });
  }

  for (const foe of sim.foes) {
    if (Math.abs(bolt.x - foe.x) > FOE_HALF) continue;
    const at = reachedAt(bolt.y, y1, foe.y - FOE_HALF, foe.y + FOE_HALF);
    if (at === null) continue;
    const foeId = foe.id;
    found.push({ at, rank: 2, resolve: (s, e) => strikeFoe(s, foeId, e) });
  }

  return found;
}

/** Take a bolt out of flight. */
function removeBolt(sim: Sim, bolt: MutBolt): void {
  const index = sim.bolts.indexOf(bolt);
  if (index >= 0) sim.bolts.splice(index, 1);
}

/** Fly every bolt for one frame and resolve the first thing each one reaches. */
export function advanceBolts(sim: Sim, dt: number, ev: FrameEvents): void {
  for (const bolt of [...sim.bolts]) {
    const y1 = bolt.y - BOLT_SPEED * dt;
    const found = strikes(sim, bolt, y1);

    const hit = found.sort((a, b) => b.at - a.at || a.rank - b.rank)[0];
    if (hit !== undefined) {
      // A bolt resolves against exactly one thing and leaves flight in the same
      // update, so it is gone before what it struck is worked out.
      removeBolt(sim, bolt);
      hit.resolve(sim, ev);
      continue;
    }

    bolt.y = y1;
    if (bolt.y < BOARD_Y) removeBolt(sim, bolt);
  }
}
