// Hollowdeep — the gas simulation: oxygen, CO2, buoyancy, and breathing (specs/gas.md).
//
// THE SIGNATURE SYSTEM. Open tiles hold two gases that diffuse through the connected open
// space (4-connectivity), settle by weight (CO2 sinks, oxygen rises), are consumed and
// exhaled by the delvers, and produced/moved by the machines (specs/power.md). Diffusion
// conserves gas — it only MOVES it between tiles; the only sources/sinks are the delvers
// (breathe) and the machines (emitOxygen / pumpGas). Left alone, a sealed pocket sours and
// the crew suffocates: this is the colony's core failure mode (specs/flow.md). Runs on the
// fixed simulation tick, never the render frame.

import {
  BUOYANCY,
  CO2_TOXIC_MAX,
  DELVER_CO2_RATE,
  DELVER_O2_RATE,
  DIFFUSE_FRACTION,
  FIXED_STEP,
  GAS_CAPACITY,
  O2_BREATHE_MIN,
  isOpenToGas,
} from "./constants";
import type { Tile, World } from "./types";
import { idx, neighbors4 } from "./world";

// Scratch flow buffers, reused across ticks (sized to the world on first use) so the step
// allocates nothing per tick.
let doxy: Float64Array | null = null;
let dco2: Float64Array | null = null;

function scratch(n: number): { o: Float64Array; c: Float64Array } {
  if (!doxy || doxy.length !== n) {
    doxy = new Float64Array(n);
    dco2 = new Float64Array(n);
  } else {
    doxy.fill(0);
    dco2!.fill(0);
  }
  return { o: doxy, c: dco2! };
}

// One diffusion + buoyancy step over the connected open tiles. Each undirected edge is
// visited once (right + down neighbors) so the transfer conserves total gas. The diffusion
// fraction is expressed per fixed tick; scaling by dt keeps it correct (and stably below
// the overshoot point) if the tick length ever changes.
export function stepGas(world: World, dt: number): void {
  const { w, h, tiles } = world;
  const { o, c } = scratch(w * h);

  // Diffusion is a per-tick fraction of the edge difference (stable, self-limiting), scaled
  // by dt so it stays correct if the tick length changes. Buoyancy is a GENTLE per-second
  // drift (a small fraction of the gas actually present) so it biases where gas settles —
  // oxygen sitting higher, CO2 pooling low — without teleporting it out of an occupied tile.
  const diff = Math.min(0.5, (DIFFUSE_FRACTION / FIXED_STEP) * dt);
  const buoy = BUOYANCY * dt;

  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = idx(w, tx, ty);
      const a = tiles[i]!;
      if (!isOpenToGas(a.kind)) continue;

      // Right edge — plain horizontal diffusion of each gas.
      if (tx + 1 < w) {
        const j = i + 1;
        const b = tiles[j]!;
        if (isOpenToGas(b.kind)) {
          const fo = (a.oxygen - b.oxygen) * diff;
          o[i] -= fo;
          o[j] += fo;
          const fc = (a.co2 - b.co2) * diff;
          c[i] -= fc;
          c[j] += fc;
        }
      }

      // Down edge — plain diffusion plus a gentle buoyancy bias (oxygen rises, CO2 sinks).
      if (ty + 1 < h) {
        const j = i + w; // the tile below
        const b = tiles[j]!;
        if (isOpenToGas(b.kind)) {
          const fo = (a.oxygen - b.oxygen) * diff;
          o[i] -= fo;
          o[j] += fo;
          const fc = (a.co2 - b.co2) * diff;
          c[i] -= fc;
          c[j] += fc;

          // Buoyancy: pull oxygen UP from the lower tile into the upper one, and CO2 DOWN
          // from the upper tile into the lower one — proportional to what is there to move.
          const oUp = b.oxygen * buoy;
          o[j] -= oUp;
          o[i] += oUp;
          const cDown = a.co2 * buoy;
          c[i] -= cDown;
          c[j] += cDown;
        }
      }
    }
  }

  // Apply, soft-capping to [0, capacity] (any excess is simply dropped — the spec allows a
  // soft cap; diffusion never overshoots so this only clips machine-fed overpressure).
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!;
    if (!isOpenToGas(t.kind)) continue;
    t.oxygen = clampGas(t.oxygen + o[i]!);
    t.co2 = clampGas(t.co2 + c[i]!);
  }
}

function clampGas(v: number): number {
  return v < 0 ? 0 : v > GAS_CAPACITY ? GAS_CAPACITY : v;
}

// A delver in an open tile consumes oxygen from it and exhales CO2 into it each tick. Many
// delvers in a small room draw its oxygen down and load it with CO2 faster than diffusion
// can refill it — the local suffocation well.
export function breathe(tile: Tile, dt: number): void {
  tile.oxygen = Math.max(0, tile.oxygen - DELVER_O2_RATE * dt);
  tile.co2 = Math.min(GAS_CAPACITY, tile.co2 + DELVER_CO2_RATE * dt);
}

// A tile is breathable when it holds an open gas volume with enough oxygen AND not too much
// CO2 (specs/gas.md). A solid/wall tile (no air) is never breathable.
export function breathableAt(tile: Tile): boolean {
  if (!isOpenToGas(tile.kind)) return false;
  return tile.oxygen >= O2_BREATHE_MIN && tile.co2 <= CO2_TOXIC_MAX;
}

// A running diffuser adds oxygen to its own tile and its open 4-neighbors, split evenly
// (specs/power.md). Called by src/power.ts with `amount = DIFFUSER_O2_OUT * dt`.
export function emitOxygen(world: World, tx: number, ty: number, amount: number): void {
  const targets: Tile[] = [];
  const self = tileAtOpen(world, tx, ty);
  if (self) targets.push(self);
  for (const n of neighbors4(world, tx, ty)) {
    const t = tileAtOpen(world, n.tx, n.ty);
    if (t) targets.push(t);
  }
  if (targets.length === 0) return;
  const share = amount / targets.length;
  for (const t of targets) t.oxygen = Math.min(GAS_CAPACITY, t.oxygen + share);
}

// A running pump actively moves waste gas: it draws CO2 from the highest-CO2 open neighbor
// and expels it into the lowest-CO2 open neighbor, up to `rate` per tick — an active
// de-stratifier that relieves the CO2 pooling buoyancy creates (specs/power.md, specs/gas.md).
export function pumpGas(world: World, tx: number, ty: number, rate: number): void {
  let from: Tile | null = null;
  let to: Tile | null = null;
  for (const n of neighbors4(world, tx, ty)) {
    const t = tileAtOpen(world, n.tx, n.ty);
    if (!t) continue;
    if (!from || t.co2 > from.co2) from = t;
    if (!to || t.co2 < to.co2) to = t;
  }
  if (!from || !to || from === to) return;
  const move = Math.min(rate, from.co2, GAS_CAPACITY - to.co2);
  if (move <= 0) return;
  from.co2 -= move;
  to.co2 += move;
}

function tileAtOpen(world: World, tx: number, ty: number): Tile | null {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return null;
  const t = world.tiles[idx(world.w, tx, ty)]!;
  return isOpenToGas(t.kind) ? t : null;
}

// ---- Colony-wide reads for the HUD, alarm, and balance goal checks ---------------
export function avgOxygen(world: World): number {
  let sum = 0;
  let n = 0;
  for (const t of world.tiles) {
    if (isOpenToGas(t.kind)) {
      sum += t.oxygen;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

export function lowestOxygen(world: World): number {
  let lo = Infinity;
  for (const t of world.tiles) {
    if (isOpenToGas(t.kind) && t.oxygen < lo) lo = t.oxygen;
  }
  return lo === Infinity ? 0 : lo;
}

export function avgCo2(world: World): number {
  let sum = 0;
  let n = 0;
  for (const t of world.tiles) {
    if (isOpenToGas(t.kind)) {
      sum += t.co2;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}
