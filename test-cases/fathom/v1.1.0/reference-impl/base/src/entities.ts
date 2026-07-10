// Fathom — movers (forager, predators, drifter) and the shared tile-locked
// movement stepping. Positions are in logical pixels; movers travel along
// corridor center-lines and only ever turn at tile centers (specs/movement.md).

import { COLS, GRID_X, PREDATOR_SPEED, TILE } from "./constants";
import { Maze } from "./maze";
import { Dir, opposite, PredState } from "./types";
import type { PredKind } from "./types";

const MAZE_LEFT = GRID_X;
const MAZE_W = COLS * TILE;
const EPS = 0.001;

export type CanEnter = (col: number, row: number) => boolean;
// Whether a mover currently travelling `from` may turn to `to` at a center.
export type CanTurn = (from: Dir, to: Dir) => boolean;
// The desired direction, queried fresh at each decision point (tile center) so
// random patrol re-picks exactly at junctions.
export type WantFn = () => Dir;

export abstract class Mover {
  x: number;
  y: number;
  dir: Dir = Dir.None;
  facing: Dir = Dir.Up;
  speed: number;
  animT = 0;
  // Reveal window (seconds) during which this mover is drawn even if unlit —
  // set when a sonar pulse or flare catches it (specs/sensing.md).
  markT = 0;

  constructor(col: number, row: number, speed: number) {
    this.x = Maze.cx(col);
    this.y = Maze.cy(row);
    this.speed = speed;
  }

  get col(): number {
    return Maze.colAt(this.x);
  }
  get row(): number {
    return Maze.rowAt(this.y);
  }
}

function moveBy(m: Mover, d: Dir, dist: number): void {
  switch (d) {
    case Dir.Up:
      m.y -= dist;
      break;
    case Dir.Down:
      m.y += dist;
      break;
    case Dir.Left:
      m.x -= dist;
      break;
    case Dir.Right:
      m.x += dist;
      break;
  }
  // Horizontal wrap tunnel (only reachable at WRAP_ROW).
  if (m.x < MAZE_LEFT) m.x += MAZE_W;
  else if (m.x >= MAZE_LEFT + MAZE_W) m.x -= MAZE_W;
}

// Distance along the current dir to the next tile center ahead.
function nextCenterDist(m: Mover): number {
  const cx = Maze.cx(m.col);
  const cy = Maze.cy(m.row);
  switch (m.dir) {
    case Dir.Right:
      return m.x < cx - EPS ? cx - m.x : cx + TILE - m.x;
    case Dir.Left:
      return m.x > cx + EPS ? m.x - cx : m.x - (cx - TILE);
    case Dir.Down:
      return m.y < cy - EPS ? cy - m.y : cy + TILE - m.y;
    case Dir.Up:
      return m.y > cy + EPS ? m.y - cy : m.y - (cy - TILE);
    default:
      return Infinity;
  }
}

function snapCenter(m: Mover): void {
  m.x = Maze.cx(m.col);
  m.y = Maze.cy(m.row);
}

// Choose the direction to leave a tile center in, given the desired dir.
function decide(
  m: Mover,
  maze: Maze,
  want: Dir,
  canEnter: CanEnter,
  canTurn: CanTurn,
): void {
  if (want !== Dir.None) {
    const n = maze.step(m.col, m.row, want);
    if (canEnter(n.col, n.row)) {
      if (
        want === m.dir ||
        want === opposite(m.dir) ||
        m.dir === Dir.None ||
        canTurn(m.dir, want)
      ) {
        m.dir = want;
        return;
      }
    }
  }
  // Otherwise keep going straight if the tile ahead is open.
  const f = maze.step(m.col, m.row, m.dir);
  if (canEnter(f.col, f.row)) return;
  m.dir = Dir.None; // blocked, cannot take the desired turn: stop
}

// Advance a mover by dt. `wantFn` is queried for the desired direction at each
// decision point (player input, or AI recomputed fresh at each junction).
export function advance(
  m: Mover,
  dt: number,
  maze: Maze,
  wantFn: WantFn,
  canEnter: CanEnter,
  canTurn: CanTurn,
): void {
  // Reversal is allowed at any time, not only at tile centers.
  const want0 = wantFn();
  if (m.dir !== Dir.None && want0 !== Dir.None && want0 === opposite(m.dir)) {
    m.dir = want0;
  }

  if (m.dir === Dir.None) {
    if (want0 !== Dir.None) {
      const n = maze.step(m.col, m.row, want0);
      if (canEnter(n.col, n.row) && canTurn(Dir.None, want0)) m.dir = want0;
    }
    if (m.dir === Dir.None) return;
  }

  let dist = m.speed * dt;
  let guard = 0;
  // `decide` can set m.dir back to None (blocked at a wall); read it widely so
  // control-flow narrowing after the early return above does not elide these.
  while (dist > EPS && (m.dir as Dir) !== Dir.None && guard++ < 200) {
    const d = nextCenterDist(m);
    if (d <= dist + EPS) {
      moveBy(m, m.dir, d);
      dist -= d;
      snapCenter(m);
      decide(m, maze, wantFn(), canEnter, canTurn);
    } else {
      moveBy(m, m.dir, dist);
      dist = 0;
    }
  }

  if ((m.dir as Dir) !== Dir.None) {
    m.facing = m.dir;
    m.animT += dt;
  }
}

export function atCenter(m: Mover): boolean {
  return (
    Math.abs(m.x - Maze.cx(m.col)) < 0.5 && Math.abs(m.y - Maze.cy(m.row)) < 0.5
  );
}

// ---- Forager -----------------------------------------------------------
export class Forager extends Mover {
  g = 0; // brightness in [0,1]

  constructor(col: number, row: number, speed: number) {
    super(col, row, speed);
    this.dir = Dir.None;
    this.facing = Dir.Up;
  }
}

// ---- Predator ----------------------------------------------------------
export class Predator extends Mover {
  kind: PredKind;
  state: PredState = PredState.Den;
  fixCol = -1; // last believed forager tile
  fixRow = -1;
  hasFix = false;
  linger = 0; // remaining time to keep hunting the last fix
  releaseAt: number; // seconds after (re)start it leaves the den
  patrolSpeed: number;
  blindT = 0; // remaining time blinded by ink (sight predators)
  alertT = 0; // detection-alert window: draw this predator lit even if unlit
  // Per-kind tell / behavior timers.
  pulseT = 0; // Gloamfin: time to next own sonar ping
  searching = false; // Gloamfin: casting about an empty fix
  searchT = 0; // Gloamfin: time left casting before giving up
  searchPingT = 0; // Gloamfin: delay before the guaranteed "lost you" ping
  flareT = 0; // Flarefish: time to next flare
  flaring = false; // Flarefish: a flare is currently playing
  flarePhaseT = 0; // Flarefish: time since the current flare started
  denTimer = 0; // time remaining in the den before release

  constructor(kind: PredKind, col: number, row: number, releaseAt: number) {
    super(col, row, 0);
    this.kind = kind;
    this.releaseAt = releaseAt;
    // Every predator wanders at the ordinary predator speed (specs/predators.md).
    this.patrolSpeed = PREDATOR_SPEED;
    this.speed = this.patrolSpeed;
  }
}

// ---- Bonus drifter -----------------------------------------------------
export class Drifter extends Mover {
  life: number;
  constructor(col: number, row: number, speed: number, life: number) {
    super(col, row, speed);
    this.life = life;
  }
}
