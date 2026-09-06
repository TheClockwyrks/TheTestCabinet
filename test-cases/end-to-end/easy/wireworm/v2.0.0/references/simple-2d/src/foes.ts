// Wireworm — the three support foes (`specs/foes.md`).
//
// Each one reshapes the node field in its own way: the glitch eats it, the
// dropper reseeds it, the corruptor slams it to critical. All three act on the
// TILE THEIR CENTER OCCUPIES, and only on that tile, so a foe held still acts
// once on the tile it stands on and a travelling one acts on each tile its
// center crosses in turn.
//
// Two faculties the debug surface poses cut across every foe. `mind` gates the
// foe's own behavior alone, which is the glitch's dart and its eating, the
// dropper's node-laying and the corruptor's slam; `travel` gates its locomotion
// alone. A frame runs the dart, then the travel, then the effect on the field,
// so a glitch that reversed this frame moves the way it just turned and eats the
// tile it ended on.

import {
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_MIN_INTERVAL,
  CORRUPTOR_SPEED,
  DROPPER_CHECK_INTERVAL,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
  DROPPER_SPEED,
  CORRUPTOR_FROM_LEVEL,
  COLS,
  GLITCH_DART_INTERVAL,
  GLITCH_FROM_LEVEL,
  GLITCH_H_SPEED,
  GLITCH_MAX_INTERVAL,
  GLITCH_MAX_ON_BOARD,
  GLITCH_MIN_INTERVAL,
  GLITCH_V_SPEED,
  SCATTER_BOTTOM_ROW,
  SCATTER_TOP_ROW,
  STAGE_H,
  STAGE_W,
  inBounds,
  tileCX,
  tileCY,
} from "./constants";
import { dropNode, hasNode, nodeAt, putNode, slamNode, tileOf } from "./field";
import { randomInt, randomRange, randomSign } from "./rng";
import {
  takeId,
  type FrameEvents,
  type MutFoe,
  type MutTile,
  type Sim,
} from "./sim";
import type { FoeKind } from "./game";

/** The row the dropper's sparse-field check counts nodes from. */
export const DROPPER_COUNT_TOP_ROW = 10;

/** The rows a glitch and a corruptor enter on. */
export const GLITCH_ENTRY_ROWS = [8, 15] as const;
export const CORRUPTOR_ENTRY_ROWS = [1, 6] as const;

/** The velocity a foe of `kind` rests at, travelling in horizontal direction `dir`. */
export function restingVelocity(
  kind: FoeKind,
  dir: number,
): { readonly vx: number; readonly vy: number } {
  switch (kind) {
    case "glitch":
      return { vx: dir * GLITCH_H_SPEED, vy: GLITCH_V_SPEED };
    case "dropper":
      return { vx: 0, vy: DROPPER_SPEED };
    case "corruptor":
      return { vx: dir * CORRUPTOR_SPEED, vy: 0 };
  }
}

/** Add one foe at a stage position, appended to the roster with a fresh id. */
export function addFoe(
  sim: Sim,
  kind: FoeKind,
  x: number,
  y: number,
  dir = 1,
): MutFoe {
  const { vx, vy } = restingVelocity(kind, dir);
  const foe: MutFoe = {
    id: takeId(sim),
    kind,
    x,
    y,
    vx,
    vy,
    hit: false,
    mind: true,
    travel: true,
    dartClock: 0,
  };
  sim.foes.push(foe);
  return foe;
}

/** Take a foe off the board. */
function removeFoe(sim: Sim, foe: MutFoe): void {
  const index = sim.foes.indexOf(foe);
  if (index >= 0) sim.foes.splice(index, 1);
}

/** What a foe does to the tile its center occupies. */
function actOnField(sim: Sim, foe: MutFoe, ev: FrameEvents): void {
  const { c, r } = tileOf(foe.x, foe.y);
  if (!inBounds(c, r)) return;

  switch (foe.kind) {
    case "glitch":
      // Any node, at any charge, and a critical one goes without detonating.
      dropNode(sim, c, r);
      return;
    case "dropper":
      if (r < SCATTER_TOP_ROW || r > SCATTER_BOTTOM_ROW) return;
      if (hasNode(sim, c, r)) return;
      putNode(sim, c, r, 0);
      return;
    case "corruptor": {
      const node = nodeAt(sim, c, r);
      if (node !== undefined) slamNode(node, ev);
      return;
    }
  }
}

/** Move every foe for one frame, then let each act on the tile it ended on. */
export function advanceFoes(sim: Sim, dt: number, ev: FrameEvents): void {
  for (const foe of [...sim.foes]) {
    if (foe.mind && foe.kind === "glitch") {
      // The dart clock carries its remainder exactly as the worm's step clock
      // does, so a frame covering several intervals makes several reversals.
      foe.dartClock += dt;
      while (foe.dartClock >= GLITCH_DART_INTERVAL) {
        foe.dartClock -= GLITCH_DART_INTERVAL;
        foe.vx = -foe.vx;
      }
    }

    if (foe.travel) {
      foe.x += foe.vx * dt;
      foe.y += foe.vy * dt;

      if (foe.kind === "glitch") {
        // A side edge turns it back into the board.
        if (foe.x <= 0) {
          foe.x = 0;
          foe.vx = Math.abs(foe.vx);
        } else if (foe.x >= STAGE_W) {
          foe.x = STAGE_W;
          foe.vx = -Math.abs(foe.vx);
        }
      } else if (foe.kind === "corruptor" && (foe.x < 0 || foe.x > STAGE_W)) {
        removeFoe(sim, foe);
        continue;
      }

      if (foe.kind !== "corruptor" && foe.y > STAGE_H) {
        removeFoe(sim, foe);
        continue;
      }
    }

    if (foe.mind) actOnField(sim, foe, ev);
  }
}

/** A fresh interval in `[lo, hi)` seconds. */
function drawInterval(lo: number, hi: number): number {
  return randomRange(lo, hi);
}

/**
 * The tile an edge-entering foe comes in on: the posed one where the debug
 * surface posed it, and otherwise a side edge by coin flip and a row drawn
 * uniformly from `rows`. A posed tile decides that one entry and is consumed.
 */
function edgeEntry(
  posed: MutTile | null,
  rows: readonly [number, number],
): MutTile {
  if (posed !== null) return posed;
  return { c: randomSign() > 0 ? 0 : COLS - 1, r: randomInt(rows[0], rows[1]) };
}

/** An edge-entering foe of `kind`, heading inward from the edge it stands against. */
function enterFromEdge(sim: Sim, kind: FoeKind, tile: MutTile): void {
  const fromLeft = tile.c === 0;
  addFoe(sim, kind, tileCX(tile.c), tileCY(tile.r), fromLeft ? 1 : -1);
}

/** A glitch entering from one edge, on a row in its entry band. */
function enterGlitch(sim: Sim): void {
  const tile = edgeEntry(sim.nextGlitchEntry, GLITCH_ENTRY_ROWS);
  sim.nextGlitchEntry = null;
  enterFromEdge(sim, "glitch", tile);
}

/** A corruptor entering from one edge, on a row in its entry band. */
function enterCorruptor(sim: Sim): void {
  const tile = edgeEntry(sim.nextCorruptorEntry, CORRUPTOR_ENTRY_ROWS);
  sim.nextCorruptorEntry = null;
  enterFromEdge(sim, "corruptor", tile);
}

/** A dropper entering at the entry row, down a column drawn uniformly. */
function enterDropper(sim: Sim): void {
  const posed = sim.nextDropperEntry;
  sim.nextDropperEntry = null;
  const column = posed === null ? randomInt(0, COLS - 1) : posed.c;
  const row = posed === null ? 0 : posed.r;
  addFoe(sim, "dropper", tileCX(column), tileCY(row));
}

/** How many nodes stand in the rows the dropper's sparse-field check reads. */
export function nodesBelow(sim: Sim): number {
  return sim.nodes.filter((node) => node.r >= DROPPER_COUNT_TOP_ROW).length;
}

/**
 * Run one frame of the level's own spawners.
 *
 * Each clock is armed lazily: a clock resting at zero draws a fresh interval on
 * the frame it is first read, which is what makes an interval count from the
 * moment the level's play became active rather than from whenever the field was
 * last touched.
 */
export function runSpawners(sim: Sim, dt: number): void {
  if (sim.level >= GLITCH_FROM_LEVEL) {
    let clock = sim.glitchTimer;
    if (clock <= 0) {
      clock = drawInterval(GLITCH_MIN_INTERVAL, GLITCH_MAX_INTERVAL);
    }
    clock -= dt;
    if (clock <= 0) {
      const onBoard = sim.foes.filter((foe) => foe.kind === "glitch").length;
      if (onBoard < GLITCH_MAX_ON_BOARD) enterGlitch(sim);
      clock = drawInterval(GLITCH_MIN_INTERVAL, GLITCH_MAX_INTERVAL);
    }
    sim.glitchTimer = clock;
  }

  if (sim.level >= CORRUPTOR_FROM_LEVEL) {
    let clock = sim.corruptorTimer;
    if (clock <= 0) {
      clock = drawInterval(CORRUPTOR_MIN_INTERVAL, CORRUPTOR_MAX_INTERVAL);
    }
    clock -= dt;
    if (clock <= 0) {
      enterCorruptor(sim);
      clock = drawInterval(CORRUPTOR_MIN_INTERVAL, CORRUPTOR_MAX_INTERVAL);
    }
    sim.corruptorTimer = clock;
  }

  if (sim.level >= DROPPER_FROM_LEVEL) {
    let clock = sim.dropperTimer;
    if (clock <= 0) clock = DROPPER_CHECK_INTERVAL;
    clock -= dt;
    if (clock <= 0) {
      if (nodesBelow(sim) < DROPPER_SPARSE_THRESHOLD) enterDropper(sim);
      clock = DROPPER_CHECK_INTERVAL;
    }
    sim.dropperTimer = clock;
  }
}
