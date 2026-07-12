// Hollowdeep — pathfinding over the walkable + climbable graph (specs/delvers.md).
//
// Delvers walk on floors and along the tops of solid ground (an open tile supported from
// below), climb LADDERS to change level, step up/down single-tile terrain, and FALL down
// through open space — they cannot stand in mid-air, cross a gap without a floor, or ascend
// without a ladder. A node is a STANDABLE tile; edges are the moves above. BFS gives the
// shortest hop path; the flood variant (bfsFrom) is computed once per delver per assignment
// so many candidate jobs can be tested against one search. Delvers dig/build INWARD from
// open space, so a work tile is reached from a standable neighbor (reachableAdjacent).

import type { TileKind, World } from "./types";
import { breathableAt } from "./gas";
import { idx } from "./world";

// The tile kinds a delver can occupy / pass through (open space + the thin built tiles).
// Solid ground, walls, and machines block movement.
function passableKind(k: TileKind | null): boolean {
  return k === "open" || k === "floor" || k === "ladder" || k === "wire";
}

function kindAt(world: World, tx: number, ty: number): TileKind | null {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return null;
  return world.tiles[idx(world.w, tx, ty)]!.kind;
}

// Can a delver STAND at (tx, ty)? A ladder or floor tile always; an open/wire tile only if
// the tile directly below supports it (solid ground, a wall, a floor, or a ladder).
export function standable(world: World, tx: number, ty: number): boolean {
  const k = kindAt(world, tx, ty);
  if (k === null) return false;
  if (k === "ladder" || k === "floor") return true;
  if (k === "open" || k === "wire") {
    const b = kindAt(world, tx, ty + 1);
    return (
      b === "dirt" ||
      b === "ore" ||
      b === "rock" ||
      b === "bedrock" ||
      b === "wall" ||
      b === "floor" ||
      b === "ladder"
    );
  }
  return false;
}

// Public alias used by the HUD / debug reads.
export function isWalkable(world: World, tx: number, ty: number): boolean {
  return standable(world, tx, ty);
}

// From a passable column position, the tile a delver settles on: itself if standable, else
// the first standable tile falling straight down. Null if the column is blocked before a
// landing (should not happen — the world bottom is bedrock).
function dropTo(world: World, tx: number, ty: number): number | null {
  for (let y = ty; y < world.h; y++) {
    if (standable(world, tx, y)) return idx(world.w, tx, y);
    if (!passableKind(kindAt(world, tx, y))) return null;
  }
  return null;
}

// The standable landing tiles reachable in one move from a standable node: sideways walks
// and step-downs / falls (drop into the adjacent column), one-tile step-ups over a ledge,
// and ladder climbs up/down.
function neighborsOf(world: World, node: number): number[] {
  const tx = node % world.w;
  const ty = (node - tx) / world.w;
  const out: number[] = [];
  const hereK = kindAt(world, tx, ty);

  for (const dx of [-1, 1]) {
    const nx = tx + dx;
    const sideK = kindAt(world, nx, ty);
    if (passableKind(sideK)) {
      // Walk into the column, then settle (level walk, step-down, or a fall into a pit).
      const land = dropTo(world, nx, ty);
      if (land !== null) out.push(land);
    } else if (sideK !== null) {
      // A solid step beside us: climb one tile up if the ledge top is standable and there
      // is headroom directly above the delver.
      if (
        standable(world, nx, ty - 1) &&
        passableKind(kindAt(world, tx, ty - 1)) &&
        passableKind(kindAt(world, nx, ty - 1))
      ) {
        out.push(idx(world.w, nx, ty - 1));
      }
    }
  }

  // Ladder up: from a ladder tile, or into a ladder tile directly above.
  const upK = kindAt(world, tx, ty - 1);
  if (passableKind(upK) && (hereK === "ladder" || upK === "ladder") && standable(world, tx, ty - 1)) {
    out.push(idx(world.w, tx, ty - 1));
  }
  // Step down onto a ladder directly below — enter (or continue) a laddered shaft from the
  // tile above its top rung, so a delver on the surface can descend into the shaft.
  if (kindAt(world, tx, ty + 1) === "ladder") {
    out.push(idx(world.w, tx, ty + 1));
  }
  // Ladder down: climb / drop down off a ladder.
  if (hereK === "ladder") {
    const dnK = kindAt(world, tx, ty + 1);
    if (passableKind(dnK)) {
      const land = dropTo(world, tx, ty + 1);
      if (land !== null) out.push(land);
    }
  }

  return out;
}

export interface Flood {
  from: number;
  prev: Map<number, number>; // node -> the node it was reached from (from -> -1)
  order: number[]; // nodes in BFS-visit order (nearest first)
}

// Breadth-first flood over the walkable graph from a standable start tile.
export function bfsFrom(world: World, fromTx: number, fromTy: number): Flood {
  const from = idx(world.w, fromTx, fromTy);
  const prev = new Map<number, number>();
  const order: number[] = [];
  if (!standable(world, fromTx, fromTy)) return { from, prev, order };
  prev.set(from, -1);
  const queue: number[] = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    order.push(cur);
    for (const nb of neighborsOf(world, cur)) {
      if (!prev.has(nb)) {
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  return { from, prev, order };
}

// Reconstruct the hop path from `flood.from` to `to` (a list of {tx,ty} EXCLUDING the start,
// ending at `to`). Null if unreachable; [] if already there.
export function pathTo(flood: Flood, to: number, w: number): { tx: number; ty: number }[] | null {
  if (to === flood.from) return [];
  if (!flood.prev.has(to)) return null;
  const rev: number[] = [];
  let cur = to;
  while (cur !== flood.from && cur !== -1) {
    rev.push(cur);
    cur = flood.prev.get(cur)!;
  }
  rev.reverse();
  return rev.map((n) => ({ tx: n % w, ty: Math.floor(n / w) }));
}

// Full path between two tiles (convenience over bfsFrom + pathTo).
export function findPath(
  world: World,
  from: { tx: number; ty: number },
  to: { tx: number; ty: number },
): { tx: number; ty: number }[] | null {
  const flood = bfsFrom(world, from.tx, from.ty);
  return pathTo(flood, idx(world.w, to.tx, to.ty), world.w);
}

// The standable tile a delver works a target from (digs/builds inward from open space): the
// 4-neighbor stand tile nearest to `from` by path. Null if the target has no reachable face.
export function reachableAdjacent(
  world: World,
  target: { tx: number; ty: number },
  from: { tx: number; ty: number },
): { tx: number; ty: number } | null {
  const flood = bfsFrom(world, from.tx, from.ty);
  const cands = new Set<number>();
  const around = [
    [target.tx - 1, target.ty],
    [target.tx + 1, target.ty],
    [target.tx, target.ty - 1],
    [target.tx, target.ty + 1],
  ];
  for (const [nx, ny] of around) {
    if (standable(world, nx!, ny!)) cands.add(idx(world.w, nx!, ny!));
  }
  for (const n of flood.order) {
    if (cands.has(n)) return { tx: n % world.w, ty: Math.floor(n / world.w) };
  }
  return null;
}

// The path to the nearest reachable BREATHABLE standable tile (specs/gas.md, delvers fleeing
// bad air). Null if none is reachable — the delver suffocates where it stands.
export function nearestBreathable(
  world: World,
  from: { tx: number; ty: number },
): { tx: number; ty: number }[] | null {
  const flood = bfsFrom(world, from.tx, from.ty);
  for (const n of flood.order) {
    if (n === flood.from) continue;
    const tile = world.tiles[n]!;
    if (breathableAt(tile)) return pathTo(flood, n, world.w);
  }
  return null;
}
