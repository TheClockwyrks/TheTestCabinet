// Fathom — the three predators (specs/predators.md). Each hunts a different
// signal the forager gives off: the Lure tracks light, the Listener tracks
// sound, the Flarefish sees only in its own flare. This module owns their den
// release, per-kind sensing, tells, and greedy/patrol movement; the generic
// tile-locked stepping lives in entities.ts.

import {
  FLARE_BLOOM,
  FLARE_CHARGE,
  FLARE_FADE,
  FLARE_HUNT_TIME,
  FLARE_INTERVAL,
  FLARE_RADIUS,
  FLAREFISH_SPEED,
  GATE_COL,
  GATE_ROW,
  LISTENER_ACCEL,
  LISTENER_HEAR_RANGE,
  LISTENER_PATROL_SPEED,
  LISTENER_PULSE_INTERVAL,
  LISTENER_TOP_SPEED,
  LISTENER_TURN_CAP,
  LURE_LINGER,
  LURE_RANGE_BASE,
  LURE_RANGE_GAIN,
  LURE_SPEED,
  ROWS,
  COLS,
  TILE,
} from "./constants";
import { advance, CanEnter, Drifter, Forager, Mover, Predator } from "./entities";
import { Effects } from "./effects";
import { Maze } from "./maze";
import { Fog } from "./sensing";
import { Dir, opposite, PredKind, PredState } from "./types";
import type { Audio } from "./audio";

export interface World {
  maze: Maze;
  fog: Fog;
  effects: Effects;
  audio: Audio;
  forager: Forager;
  fcol: number;
  frow: number;
  depthMult: number;
  predators: Predator[];
  drifter: Drifter | null;
  rand: () => number;
  inkAt: (x: number, y: number) => boolean;
  inkBetween: (x1: number, y1: number, x2: number, y2: number) => boolean;
}

const DIRS = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function manhattan(ac: number, ar: number, bc: number, br: number): number {
  return Math.abs(ac - bc) + Math.abs(ar - br);
}

// Greedy: the open direction that most reduces grid distance to the target,
// preferring not to reverse.
function greedyDir(
  p: Mover,
  tc: number,
  tr: number,
  canEnter: CanEnter,
  maze: Maze,
): Dir {
  let best: Dir = p.dir;
  let bestD = Infinity;
  for (const d of DIRS) {
    if (d === opposite(p.dir) && p.dir !== Dir.None) continue;
    const n = maze.step(p.col, p.row, d);
    if (!canEnter(n.col, n.row)) continue;
    const dd = manhattan(n.col, n.row, tc, tr);
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  if (bestD === Infinity) {
    // Only the reverse is open (a corner): take it.
    const rev = opposite(p.dir);
    const n = maze.step(p.col, p.row, rev);
    if (canEnter(n.col, n.row)) return rev;
  }
  return best;
}

// Random wander: an open direction, avoiding an immediate reverse when possible.
function patrolDir(
  p: Mover,
  canEnter: CanEnter,
  maze: Maze,
  rand: () => number,
): Dir {
  const opts: Dir[] = [];
  for (const d of DIRS) {
    const n = maze.step(p.col, p.row, d);
    if (canEnter(n.col, n.row)) opts.push(d);
  }
  const noRev = opts.filter((d) => d !== opposite(p.dir));
  const pool = noRev.length ? noRev : opts;
  if (!pool.length) return Dir.None;
  // Keep going straight if that stays open, most of the time, for readable lines.
  if (pool.includes(p.dir) && rand() < 0.55) return p.dir;
  return pool[Math.floor(rand() * pool.length)];
}

function revealFlareArea(p: Predator, w: World): void {
  const rad = Math.ceil(FLARE_RADIUS / TILE) + 1;
  const R2 = FLARE_RADIUS * FLARE_RADIUS;
  for (let r = p.row - rad; r <= p.row + rad; r++) {
    if (r < 0 || r >= ROWS) continue;
    for (let c = p.col - rad; c <= p.col + rad; c++) {
      if (c < 0 || c >= COLS) continue;
      const dx = Maze.cx(c) - p.x;
      const dy = Maze.cy(r) - p.y;
      if (dx * dx + dy * dy > R2) continue;
      if (!Fog.losClear(w.maze, p.col, p.row, c, r)) continue;
      w.fog.reveal(c, r);
    }
  }
  // Any predator or the drifter caught in the bloom is shown live.
  const others: Mover[] = [...w.predators, ...(w.drifter ? [w.drifter] : [])];
  for (const o of others) {
    if (o === p) continue;
    if (dist(o.x, o.y, p.x, p.y) <= FLARE_RADIUS && Fog.losClear(w.maze, p.col, p.row, o.col, o.row))
      o.markT = Math.max(o.markT, 0.12);
  }
}

// ---- per-kind sensing --------------------------------------------------

function updateLure(p: Predator, dt: number, w: World, mult: number): void {
  p.speed = LURE_SPEED * mult;
  let sensed = false;
  if (p.blindT <= 0) {
    const R = LURE_RANGE_BASE + LURE_RANGE_GAIN * w.forager.g;
    if (
      dist(p.x, p.y, w.forager.x, w.forager.y) <= R &&
      Fog.losClear(w.maze, p.col, p.row, w.fcol, w.frow) &&
      !w.inkBetween(p.x, p.y, w.forager.x, w.forager.y)
    ) {
      sensed = true;
    }
  }
  if (sensed) {
    p.hasFix = true;
    p.fixCol = w.fcol;
    p.fixRow = w.frow;
    p.linger = LURE_LINGER;
    p.state = PredState.Hunt;
  } else if (p.blindT > 0) {
    p.hasFix = false;
    p.linger = 0;
    p.state = PredState.Patrol;
  } else if (p.linger > 0) {
    p.linger -= dt;
    p.state = PredState.Hunt;
    if (p.linger <= 0) {
      p.hasFix = false;
      p.state = PredState.Patrol;
    }
  } else {
    p.hasFix = false;
    p.state = PredState.Patrol;
  }
}

function updateListener(p: Predator, dt: number, w: World, mult: number): void {
  const patrol = LISTENER_PATROL_SPEED * mult;
  const close = dist(p.x, p.y, w.forager.x, w.forager.y) <= LISTENER_HEAR_RANGE;
  if (close) {
    p.hasFix = true;
    p.fixCol = w.fcol;
    p.fixRow = w.frow;
    p.linger = Math.max(p.linger, 1);
    p.state = PredState.Hunt;
  } else if (p.linger > 0) {
    p.linger -= dt;
    p.state = PredState.Hunt;
    if (p.linger <= 0) {
      p.hasFix = false;
      p.state = PredState.Patrol;
    }
  } else {
    p.hasFix = false;
    p.state = PredState.Patrol;
  }
  // Tell: its own periodic sonar pulse (specs/predators.md).
  p.pulseT -= dt;
  if (p.pulseT <= 0) {
    p.pulseT = LISTENER_PULSE_INTERVAL;
    w.effects.addRing(p.x, p.y, 3 * TILE, true);
    p.markT = Math.max(p.markT, 0.9);
    for (const cell of w.maze.flood(p.col, p.row, 3)) w.fog.reveal(cell.col, cell.row);
    w.audio.play("predPulse");
  }
  // Speed: patrols at a fixed pace, accelerates while hunting.
  if (p.state === PredState.Hunt && p.hasFix) {
    p.speed = Math.min(LISTENER_TOP_SPEED * mult, Math.max(p.speed, patrol) + LISTENER_ACCEL * dt);
  } else {
    p.speed = patrol;
  }
}

function updateFlarefish(p: Predator, dt: number, w: World, mult: number): void {
  p.speed = FLAREFISH_SPEED * mult;
  if (!p.flaring) {
    p.flareT -= dt;
    if (p.flareT <= 0) {
      p.flaring = true;
      p.flarePhaseT = 0;
      p.flareT = FLARE_INTERVAL;
    }
  }
  if (p.flaring) {
    // The charge-up glow and bloom telegraph the Flarefish's own position.
    p.markT = Math.max(p.markT, 0.05);
    const prev = p.flarePhaseT;
    p.flarePhaseT += dt;
    const bloomStart = FLARE_CHARGE;
    const bloomEnd = FLARE_CHARGE + FLARE_BLOOM;
    const fadeEnd = bloomEnd + FLARE_FADE;
    if (prev < bloomStart && p.flarePhaseT >= bloomStart) {
      w.audio.play("flare");
      const blinded =
        p.blindT > 0 ||
        w.inkAt(w.forager.x, w.forager.y) ||
        w.inkBetween(p.x, p.y, w.forager.x, w.forager.y);
      if (
        dist(p.x, p.y, w.forager.x, w.forager.y) <= FLARE_RADIUS &&
        !blinded &&
        Fog.losClear(w.maze, p.col, p.row, w.fcol, w.frow)
      ) {
        p.hasFix = true;
        p.fixCol = w.fcol;
        p.fixRow = w.frow;
        p.linger = FLARE_HUNT_TIME;
        p.state = PredState.Hunt;
      }
    }
    if (p.flarePhaseT >= bloomStart && p.flarePhaseT < bloomEnd) revealFlareArea(p, w);
    if (p.flarePhaseT >= fadeEnd) p.flaring = false;
  }
  if (p.blindT > 0) {
    p.hasFix = false;
    p.linger = 0;
    p.state = PredState.Patrol;
  } else if (p.linger > 0) {
    p.linger -= dt;
    p.state = PredState.Hunt;
    if (p.linger <= 0) {
      p.hasFix = false;
      p.state = PredState.Patrol;
    }
  } else if (!p.hasFix) {
    p.state = PredState.Patrol;
  }
}

// ---- per-step update ---------------------------------------------------

export function updatePredator(p: Predator, dt: number, w: World): void {
  const mult = w.depthMult;
  if (p.markT > 0) p.markT = Math.max(0, p.markT - dt);
  if (p.blindT > 0) p.blindT = Math.max(0, p.blindT - dt);

  const canPatrol: CanEnter = (c, r) => w.maze.foragerOpen(c, r);
  const canDen: CanEnter = (c, r) => w.maze.predOpen(c, r);

  // Den: idle until release, then navigate up and out through the gate.
  if (p.state === PredState.Den) {
    p.denTimer -= dt;
    if (p.denTimer > 0) {
      p.dir = Dir.None;
      return;
    }
    p.speed = p.patrolSpeed * mult;
    advance(
      p,
      dt,
      w.maze,
      () => greedyDir(p, GATE_COL, GATE_ROW - 1, canDen, w.maze),
      canDen,
      () => true,
    );
    if (p.row <= GATE_ROW - 1 && !w.maze.isDen(p.col, p.row)) {
      p.state = PredState.Patrol;
    }
    return;
  }

  switch (p.kind) {
    case PredKind.Lure:
      updateLure(p, dt, w, mult);
      break;
    case PredKind.Listener:
      updateListener(p, dt, w, mult);
      break;
    case PredKind.Flarefish:
      updateFlarefish(p, dt, w, mult);
      break;
  }

  const hunting = p.state === PredState.Hunt && p.hasFix;
  const canTurn =
    p.kind === PredKind.Listener
      ? (from: Dir, to: Dir) =>
          from === Dir.None ||
          to === from ||
          to === opposite(from) ||
          p.speed <= LISTENER_TURN_CAP
      : () => true;
  const wantFn = hunting
    ? () => greedyDir(p, p.fixCol, p.fixRow, canPatrol, w.maze)
    : () => patrolDir(p, canPatrol, w.maze, w.rand);

  advance(p, dt, w.maze, wantFn, canPatrol, canTurn);

  // A Listener that stalls (too fast to corner into the only opening) sheds its
  // speed so it can turn on the next pass — the overshoot-and-loop-back juke.
  if (p.kind === PredKind.Listener && p.dir === Dir.None) {
    p.speed = p.patrolSpeed * mult;
  }
}
