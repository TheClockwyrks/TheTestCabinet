// Holdfast — grid A* over the walkable graph (DESIGN §4, specs/settlers.md).
//
// Settlers and raiders move on foot across walkable tiles and reroute around new obstacles
// (a wall built, a door, a cleared node). This module answers three questions the sim asks
// each time an entity picks a destination: the path to a tile (findPath), the path to a
// tile ADJACENT to a work tile the entity cannot stand on — a tree, a wall ghost, a stove
// (reachableAdjacent), and whether a destination is reachable at all (isReachable). Paths
// are 8-connected with no corner-cutting through blocked tiles, and are returned as the
// sequence of tile steps AFTER the start tile (empty when already there).

import { World, tileCenterX, tileCenterY } from "./world";
import type { PathNode } from "./types";
import { COLS } from "./constants";

const SQRT2 = Math.SQRT2;

// A tiny binary min-heap keyed by f-score (fast enough for the 60×44 grid).
class Heap {
  private ids: number[] = [];
  private fs: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, f: number): void {
    this.ids.push(id);
    this.fs.push(f);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fs[p]! <= this.fs[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastF = this.fs.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.fs[0] = lastF;
      let i = 0;
      const n = this.ids.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < n && this.fs[l]! < this.fs[m]!) m = l;
        if (r < n && this.fs[r]! < this.fs[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.fs[a], this.fs[b]] = [this.fs[b]!, this.fs[a]!];
  }
}

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

type GoalTest = (x: number, y: number) => boolean;

// Core A*. `goal` decides which tile ends the search; (gx, gy) anchors the heuristic (the
// nominal target). Returns the step sequence after `from`, or null if no goal is reachable.
function astar(world: World, from: PathNode, goal: GoalTest, gx: number, gy: number, forRaider: boolean): PathNode[] | null {
  const start = from.ty * COLS + from.tx;
  if (goal(from.tx, from.ty)) return [];
  const came = new Map<number, number>();
  const g = new Map<number, number>();
  const closed = new Set<number>();
  const open = new Heap();
  g.set(start, 0);
  open.push(start, octile(from.tx, from.ty, gx, gy));

  while (open.size > 0) {
    const cur = open.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cx = cur % COLS;
    const cy = (cur - cx) / COLS;
    if (goal(cx, cy)) return reconstruct(came, cur);
    const cg = g.get(cur)!;
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!world.passable(nx, ny, forRaider)) continue;
      // no corner-cutting: a diagonal step needs both flanking orthogonal tiles open
      if (dx !== 0 && dy !== 0 && (!world.passable(cx + dx, cy, forRaider) || !world.passable(cx, cy + dy, forRaider))) continue;
      const nid = ny * COLS + nx;
      if (closed.has(nid)) continue;
      const ng = cg + cost;
      if (ng < (g.get(nid) ?? Infinity)) {
        g.set(nid, ng);
        came.set(nid, cur);
        open.push(nid, ng + octile(nx, ny, gx, gy));
      }
    }
  }
  return null;
}

function reconstruct(came: Map<number, number>, goal: number): PathNode[] {
  const rev: PathNode[] = [];
  let cur: number | undefined = goal;
  while (cur !== undefined && came.has(cur)) {
    const x = cur % COLS;
    rev.push({ tx: x, ty: (cur - x) / COLS });
    cur = came.get(cur);
  }
  rev.reverse();
  return rev;
}

// Path to a specific walkable tile (the tile itself must be passable). Steps after `from`.
export function findPath(world: World, from: PathNode, to: PathNode, forRaider = false): PathNode[] | null {
  if (!world.passable(to.tx, to.ty, forRaider)) return null;
  return astar(world, from, (x, y) => x === to.tx && y === to.ty, to.tx, to.ty, forRaider);
}

// Path to the nearest reachable tile adjacent to (or on) a work tile — the walk target for a
// chop/mine/build/cook/farm/tend that the settler cannot stand ON (a node/wall blocks it).
// If the work tile is itself walkable (a drop pile, a floor ghost), standing on it counts.
export function reachableAdjacent(world: World, from: PathNode, work: PathNode, forRaider = false): PathNode[] | null {
  const onWork = world.passable(work.tx, work.ty, forRaider);
  const goal: GoalTest = (x, y) => {
    if (x === work.tx && y === work.ty) return onWork;
    return Math.abs(x - work.tx) <= 1 && Math.abs(y - work.ty) <= 1 && world.passable(x, y, forRaider);
  };
  return astar(world, from, goal, work.tx, work.ty, forRaider);
}

export function isReachable(world: World, from: PathNode, to: PathNode, forRaider = false): boolean {
  return findPath(world, from, to, forRaider) !== null;
}

// ---- Movement along a path -----------------------------------------------------
// Anything the sim walks — a settler or a raider — carries a continuous pixel position, a
// heading, and a tile path. moveAlong advances it toward the current path node at `speedPx`
// px/s for `dt` seconds, snapping to a node it reaches and stepping the index. Returns true
// when the path is fully walked (the entity has arrived).
export interface Mover {
  x: number;
  y: number;
  facing: number;
  path: PathNode[];
  pathIdx: number;
}
export function moveAlong(m: Mover, speedPx: number, dt: number): boolean {
  if (m.pathIdx >= m.path.length) return true;
  const node = m.path[m.pathIdx]!;
  const cx = tileCenterX(node.tx);
  const cy = tileCenterY(node.ty);
  const dx = cx - m.x;
  const dy = cy - m.y;
  const d = Math.hypot(dx, dy);
  const step = speedPx * dt;
  if (d <= step || d < 0.001) {
    m.x = cx;
    m.y = cy;
    m.pathIdx += 1;
  } else {
    m.facing = Math.atan2(dy, dx);
    m.x += (dx / d) * step;
    m.y += (dy / d) * step;
  }
  return m.pathIdx >= m.path.length;
}

// The tile an entity ends up on after walking `path` from `from` (its last step, or `from`
// when the path is empty because it is already there).
export function endOf(path: PathNode[], from: PathNode): PathNode {
  return path.length > 0 ? path[path.length - 1]! : from;
}
