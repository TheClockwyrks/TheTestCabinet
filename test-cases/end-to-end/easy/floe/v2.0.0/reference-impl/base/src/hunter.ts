// Floe — the hunter's brain (specs/hunter.md).
//
// The bear navigates the same grid the critter does. Each hop it steps one tile
// along a route toward the critter that AVOIDS the sliding vehicles and never
// enters the far-shore wall or a bay. We compute a breadth-first distance field
// from the critter's tile over the passable tiles, then the bear descends it —
// so a vehicle-choked lane naturally delays and detours it (it waits or routes
// around), exactly as the spec requires.

import { COLS, ROW_BAYS, ROWS } from "./constants";

export interface WorldView {
  // Does a vehicle cover this ice-band tile now, OR is one about to sweep into it
  // within a hop? The bear routes around the threat rather than diving in front
  // of moving traffic (a player can still corner it into a hazard).
  vehicleThreatens(col: number, row: number): boolean;
}

export interface Tile {
  col: number;
  row: number;
}

// The bear may stand on any tile except the far-shore cap/bays (rows 0..1) and a
// tile a vehicle covers. Water and floe tiles are all passable (it swims).
function passable(world: WorldView, col: number, row: number): boolean {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
  if (row <= ROW_BAYS) return false; // far-shore wall + bays are walled to the bear
  if (world.vehicleThreatens(col, row)) return false;
  return true;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// Choose the bear's next tile from `from`, hunting `target`. Returns `from`
// itself when it is boxed in (it waits a beat rather than diving into traffic).
export function chooseBearStep(
  world: WorldView,
  from: Tile,
  target: Tile,
): Tile {
  // BFS distance from the target across passable tiles. If the target itself is
  // blocked (e.g. the critter is standing in traffic), seed from its passable
  // neighbors so the bear still closes on it.
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  const idx = (c: number, r: number): number => r * COLS + c;
  const queue: number[] = [];

  const seed = (c: number, r: number, d: number): void => {
    if (!passable(world, c, r)) return;
    const i = idx(c, r);
    if (dist[i] !== -1) return;
    dist[i] = d;
    queue.push(i);
  };

  if (passable(world, target.col, target.row)) {
    seed(target.col, target.row, 0);
  } else {
    for (const [dc, dr] of NEIGHBORS) seed(target.col + dc, target.row + dr, 1);
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const c = i % COLS;
    const r = (i - c) / COLS;
    const nd = dist[i] + 1;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!passable(world, nc, nr)) continue;
      const ni = idx(nc, nr);
      if (dist[ni] !== -1) continue;
      dist[ni] = nd;
      queue.push(ni);
    }
  }

  // Descend the field: pick the passable neighbor with the smallest distance,
  // improving on the bear's own tile. Ties break toward the target.
  let best: Tile = { col: from.col, row: from.row };
  let bestDist = dist[idx(from.col, from.row)];
  if (bestDist === -1) bestDist = Number.POSITIVE_INFINITY;

  for (const [dc, dr] of NEIGHBORS) {
    const nc = from.col + dc;
    const nr = from.row + dr;
    if (!passable(world, nc, nr)) continue;
    const d = dist[idx(nc, nr)];
    if (d === -1) continue;
    if (
      d < bestDist ||
      (d === bestDist &&
        manhattan(nc, nr, target) < manhattan(best.col, best.row, target))
    ) {
      best = { col: nc, row: nr };
      bestDist = d;
    }
  }
  if (best.col !== from.col || best.row !== from.row) return best;

  // The distance field did not help (a shifting wall of traffic momentarily cut
  // the bear off from the critter). Keep the pressure on: push greedily toward
  // the target through any passable neighbor. Diving toward a closing gap is how
  // the bear ends up eating a vehicle when the player lures it — which is fair.
  let fbDist = manhattan(from.col, from.row, target);
  for (const [dc, dr] of NEIGHBORS) {
    const nc = from.col + dc;
    const nr = from.row + dr;
    if (!passable(world, nc, nr)) continue;
    const m = manhattan(nc, nr, target);
    if (m < fbDist) {
      best = { col: nc, row: nr };
      fbDist = m;
    }
  }
  return best;
}

function manhattan(col: number, row: number, t: Tile): number {
  return Math.abs(col - t.col) + Math.abs(row - t.row);
}
