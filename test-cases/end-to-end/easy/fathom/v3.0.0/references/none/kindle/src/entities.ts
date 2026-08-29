// Fathom — the bodies that travel the maze, and the stepping they share.
//
// The forager, the predators and the bonus drifters all slide along corridor
// center lines at their own speed and change direction only where the rules of
// `specs/movement.md` allow: a reversal anywhere on a tile, a quarter turn at a
// tile center. That stepping is written once here and every body uses it.

import {
  GLOAMFIN_CHASE_SPEED,
  GRID_COLS,
  PREDATOR_SPEED,
  TILE,
} from "./constants";
import { Maze } from "./maze";
import type { CanEnter } from "./maze";
import type { Rng } from "./rng";
import type { Cell, Dir, Heading, PredatorKind, PredatorState } from "./types";
import { DIRS, isPerpendicular, opposite } from "./types";

const MAZE_LEFT = Maze.centerX(0) - TILE / 2;
const MAZE_WIDTH = GRID_COLS * TILE;

/** Slack, in logical units, for comparing a position against a tile center. */
const EPS = 0.001;

/** The desired direction, asked afresh at every point a body may turn. */
export type WantDir = () => Heading;

export abstract class Mover {
  x: number;
  y: number;

  /**
   * Where this body stood when the current step began. The renderer draws
   * between that and the current position, so motion is smooth even though the
   * simulation moves in whole ticks. Written by the step, read by the renderer,
   * never the other way about.
   */
  prevX: number;
  prevY: number;

  /** The direction it is travelling, or `null` while it is at rest. */
  dir: Heading = null;

  /** Its facing, which it keeps at rest. */
  facing: Dir = "up";

  speed: number;

  /** Elapsed travel time, which the sprite sheets are cycled on. */
  animT = 0;

  constructor(col: number, row: number, speed: number) {
    this.x = Maze.centerX(col);
    this.y = Maze.centerY(row);
    this.prevX = this.x;
    this.prevY = this.y;
    this.speed = speed;
  }

  get col(): number {
    return Maze.colAt(this.x);
  }

  get row(): number {
    return Maze.rowAt(this.y);
  }

  get tile(): Cell {
    return { col: this.col, row: this.row };
  }

  viewX(alpha: number): number {
    return this.prevX + (this.x - this.prevX) * alpha;
  }

  viewY(alpha: number): number {
    return this.prevY + (this.y - this.prevY) * alpha;
  }

  /** Collapse the interpolation window, after a jump rather than a step. */
  syncView(): void {
    this.prevX = this.x;
    this.prevY = this.y;
  }

  /** Put the body at rest on a tile's center, keeping its facing. */
  placeOn(col: number, row: number): void {
    this.x = Maze.centerX(col);
    this.y = Maze.centerY(row);
    this.dir = null;
    this.syncView();
  }
}

/** Whether a body stands on the center of its tile. */
export function atCenter(m: Mover): boolean {
  return (
    Math.abs(m.x - Maze.centerX(m.col)) < 0.5 &&
    Math.abs(m.y - Maze.centerY(m.row)) < 0.5
  );
}

function moveBy(m: Mover, maze: Maze, d: Dir, distance: number): void {
  switch (d) {
    case "up":
      m.y -= distance;
      break;
    case "down":
      m.y += distance;
      break;
    case "left":
      m.x -= distance;
      break;
    case "right":
      m.x += distance;
      break;
  }
  // The wrap tunnel is one ordinary step: the body is carried across, landing
  // as far past the far border as it had gone past the near one. Re-anchor the
  // interpolation window so it is not drawn streaking back across the maze.
  if (Maze.rowAt(m.y) !== maze.wrapRow) return;
  if (m.x < MAZE_LEFT) {
    m.x += MAZE_WIDTH;
    m.syncView();
  } else if (m.x >= MAZE_LEFT + MAZE_WIDTH) {
    m.x -= MAZE_WIDTH;
    m.syncView();
  }
}

/** How far along the current heading the next tile center lies. */
function nextCenterDistance(m: Mover): number {
  const cx = Maze.centerX(m.col);
  const cy = Maze.centerY(m.row);
  switch (m.dir) {
    case "right":
      return m.x < cx - EPS ? cx - m.x : cx + TILE - m.x;
    case "left":
      return m.x > cx + EPS ? m.x - cx : m.x - (cx - TILE);
    case "down":
      return m.y < cy - EPS ? cy - m.y : cy + TILE - m.y;
    case "up":
      return m.y > cy + EPS ? m.y - cy : m.y - (cy - TILE);
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function snapToCenter(m: Mover): void {
  m.x = Maze.centerX(m.col);
  m.y = Maze.centerY(m.row);
}

/**
 * Choose the heading to leave a tile center on. With nothing desired the body
 * comes to rest. Otherwise the desired direction is taken when the tile that way
 * is open; failing that the body carries on while the tile ahead is open, and
 * comes to rest at the center when it is not.
 */
function decide(m: Mover, maze: Maze, want: Heading, canEnter: CanEnter): void {
  if (want === null) {
    m.dir = null;
    return;
  }
  const wanted = maze.step(m.col, m.row, want);
  if (canEnter(wanted.col, wanted.row)) {
    m.dir = want;
    return;
  }
  if (m.dir === null) return;
  const ahead = maze.step(m.col, m.row, m.dir);
  if (canEnter(ahead.col, ahead.row)) return;
  m.dir = null;
}

/**
 * Advance a body by `dt`. `want` is asked afresh at every point the body may
 * turn, so a wandering creature re-picks at each junction and held input is read
 * at each center.
 */
export function advance(
  m: Mover,
  dt: number,
  maze: Maze,
  want: WantDir,
  canEnter: CanEnter,
): void {
  // Travel carries a body only along tiles open to it, so a body standing on a
  // tile that is closed to it — which is what a newly posed layout can leave it
  // on — holds that tile and travels nowhere.
  if (!canEnter(m.col, m.row)) {
    m.dir = null;
    return;
  }

  // Nothing desired: the body comes to rest where it stands.
  const first = want();
  if (first === null) {
    m.dir = null;
    return;
  }

  // A reversal is honored at once, wherever the body stands on its tile.
  if (m.dir !== null && first === opposite(m.dir)) m.dir = first;

  if (m.dir === null) {
    const wanted = maze.step(m.col, m.row, first);
    const onCenter = atCenter(m);
    if (
      canEnter(wanted.col, wanted.row) &&
      (onCenter || !isPerpendicular(m.facing, first))
    ) {
      m.dir = first;
    } else if (!onCenter) {
      // A quarter turn is taken at a center and nowhere else, so a body resting
      // part-way along a tile resumes on its own axis and turns when it gets
      // there, with the desired direction still buffered.
      const ahead = maze.step(m.col, m.row, m.facing);
      if (!canEnter(ahead.col, ahead.row)) return;
      m.dir = m.facing;
    } else {
      return;
    }
  }

  let remaining = m.speed * dt;
  // A body cannot cross more centers in one tick than its speed allows; the
  // bound is a guard against a degenerate speed rather than a rule.
  let guard = 0;
  while (remaining > EPS && m.dir !== null && guard < 256) {
    guard++;
    const toCenter = nextCenterDistance(m);
    if (toCenter <= remaining + EPS) {
      moveBy(m, maze, m.dir, toCenter);
      remaining -= toCenter;
      snapToCenter(m);
      decide(m, maze, want(), canEnter);
    } else {
      moveBy(m, maze, m.dir, remaining);
      remaining = 0;
    }
  }

  if (m.dir !== null) {
    m.facing = m.dir;
    m.animT += dt;
  }
}

/**
 * The wander both the bonus drifter and an undetected Lanternjaw take: an open
 * corridor direction drawn at random, preferring one other than the way it came,
 * and turning back only where the tile offers nothing else.
 */
export function wanderDir(
  m: Mover,
  maze: Maze,
  rng: Rng,
  canEnter: CanEnter,
): Heading {
  // The pick is made at a tile center and held until the next one, because that
  // is where a body may turn.
  if (m.dir !== null && !atCenter(m)) return m.dir;
  const open: Dir[] = [];
  for (const d of DIRS) {
    const n = maze.step(m.col, m.row, d);
    if (canEnter(n.col, n.row)) open.push(d);
  }
  if (open.length === 0) return null;
  const back = m.dir === null ? null : opposite(m.dir);
  const forward = back === null ? open : open.filter((d) => d !== back);
  return rng.pick(forward.length > 0 ? forward : open);
}

// ---- The forager -----------------------------------------------------------

export class Forager extends Mover {
  /** Brightness G, in [0, 1]. */
  brightness = 0;

  /** Seconds the brightness holds steady before it begins to decay. */
  hold = 0;

  constructor(col: number, row: number, speed: number) {
    super(col, row, speed);
  }
}

// ---- The predators ---------------------------------------------------------

export class Predator extends Mover {
  readonly kind: PredatorKind;

  /** Where it is and what it is doing, as the snapshot reports it. */
  state: PredatorState = "den";

  /** Whether its turn in the staggered schedule has come. */
  released = false;

  /** Seconds after live play begins at which its turn comes. */
  readonly releaseAt: number;

  /** Seconds still to wait in the den before its turn comes. */
  denTimer: number;

  /** Whether it runs its own mind, which is how a dive is played. */
  mind = true;

  /** The tile it believes the forager is on, or `null` while it has none. */
  fix: Cell | null = null;

  /** Seconds a lapsed fix is still pursued, for the two light hunters. */
  linger = 0;

  /** Seconds its detection alert still reports and draws. */
  alertT = 0;

  /** Seconds a sonar mark still draws its body. */
  markT = 0;

  // The Gloamfin's own state.
  /** Seconds to its next ping. */
  pingTimer = 0;
  /** Seconds of the floor between two pings still to run. */
  pingGap = 0;
  /** Whether it holds a continuous close-range hearing lock. */
  hearingLock = false;
  /** Seconds of the search still to run, once it reaches an empty fix. */
  searchTimer = 0;
  /** Seconds to the one guaranteed lost-you ping of the current search. */
  searchPingTimer = 0;
  /** Whether the current search has already cast that ping. */
  searchPinged = false;
  /**
   * Its current chase speed, which opens at the cap, is knocked down by a
   * corner, and ramps back to the cap from there.
   */
  chaseSpeed = GLOAMFIN_CHASE_SPEED;

  // The Flarefish's own state.
  /** Seconds to its next flare, running only while it wanders unflared. */
  flareTimer = 0;
  /** Which beat of the flare is playing. */
  flarePhase: "none" | "charge" | "bloom" | "fade" = "none";
  /** Seconds the current beat has been playing. */
  flarePhaseT = 0;

  constructor(kind: PredatorKind, col: number, row: number, releaseAt: number) {
    super(col, row, PREDATOR_SPEED);
    this.kind = kind;
    this.releaseAt = releaseAt;
    this.denTimer = releaseAt;
  }
}

// ---- The bonus drifters ----------------------------------------------------

/** A drifter stays in the maze until it is eaten, so it carries no lifetime. */
export class Drifter extends Mover {
  /** Whether it runs its own wander, which is how a dive is played. */
  mind = true;
}

/** Whether a body's heading changed by a quarter turn between two steps. */
export function turnedCorner(before: Heading, after: Heading): boolean {
  return before !== null && after !== null && isPerpendicular(before, after);
}
