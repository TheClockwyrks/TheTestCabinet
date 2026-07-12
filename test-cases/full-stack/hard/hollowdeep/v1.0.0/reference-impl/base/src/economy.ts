// Hollowdeep — the economy: resources, refining, build orders, and food (specs/economy.md).
//
// The colony's material loop is one chain: dig ore -> refine to material -> build the
// machines/farm from material -> those keep the crew breathing and fed. This file owns the
// resource stocks, the ore->material refine rule, build-order placement legality + cost +
// completion (turning a ghost into a finished tile and wiring it into the gas/power/walk
// graph), farm growth + harvest, and generator refueling from the ore stock. Delvers do the
// labor and time (src/sim.ts); the player only places orders (specs/controls.md).

import {
  BUILD_COST,
  FARM_GROW_TIME,
  GEN_FUEL_MAX,
  HARVEST_YIELD,
  REFINE_ORE_PER_MATERIAL,
  isMachine,
} from "./constants";
import type { BuildKind, Farm, Machine, MachineKind, World } from "./types";
import { tileAt } from "./world";

export { BUILD_COST };

// The colony's stocks, shown in the HUD (specs/flow.md). Hauling is folded in: a dig drops
// ore straight to `ore`, refining moves ore->material, harvests add food (see the README).
export interface Stocks {
  ore: number;
  material: number;
  food: number;
}

export function makeStocks(ore: number, material: number, food: number): Stocks {
  return { ore, material, food };
}

// Is `kind` a legal placement on (tx, ty)? Every building goes onto an empty OPEN tile with
// no pending ghost; a farm additionally needs solid ground beneath it to root in. Walls
// against rock, floors across open space, ladders/wires/machines on open space all satisfy
// this (specs/economy.md).
export function canPlace(world: World, tx: number, ty: number, kind: BuildKind): boolean {
  const t = tileAt(world, tx, ty);
  if (!t) return false;
  if (t.kind !== "open") return false;
  if (t.ghost !== null) return false;
  if (kind === "farm") {
    const below = tileAt(world, tx, ty + 1);
    if (!below) return false;
    const b = below.kind;
    const supported = b === "dirt" || b === "ore" || b === "rock" || b === "bedrock" || b === "floor" || b === "wall";
    if (!supported) return false;
  }
  return true;
}

// Mark a build ghost on a tile (the material is paid at completion, not here — the ghost
// waits in the queue until the colony can afford it; no partial refund, see the README).
// Returns false if the placement is illegal.
export function placeGhost(world: World, tx: number, ty: number, kind: BuildKind): boolean {
  if (!canPlace(world, tx, ty, kind)) return false;
  const t = tileAt(world, tx, ty)!;
  t.ghost = kind;
  t.ghostPaid = false;
  return true;
}

// Can the colony afford this build right now (material in stock)?
export function canAfford(stocks: Stocks, kind: BuildKind): boolean {
  return stocks.material >= BUILD_COST[kind];
}

// Complete a build: pay its material, turn the ghost into the finished tile, and register
// any machine/farm/refinery so power, gas, and the walk graph pick it up. Assumes the build
// was affordable (the caller gates the job on canAfford). Returns the finished kind.
export function completeBuild(world: World, stocks: Stocks, tx: number, ty: number): BuildKind | null {
  const t = tileAt(world, tx, ty);
  if (!t || t.ghost === null) return null;
  const kind = t.ghost;
  stocks.material -= BUILD_COST[kind];
  t.ghost = null;
  t.ghostPaid = true;
  t.designated = false;
  t.kind = kind;

  if (kind === "wall") {
    // A wall now blocks gas — the air it held is displaced (dropped, per the soft-cap rule).
    t.oxygen = 0;
    t.co2 = 0;
  }

  if (kind === "generator" || kind === "diffuser" || kind === "pump") {
    const m: Machine = {
      id: world.machines.length, // stable id (machines are not removed) — keys the vent fx
      kind: kind as MachineKind,
      tx,
      ty,
      network: -1,
      powered: false,
      running: false,
      fuel: 0,
      ventPhase: 0,
    };
    world.machines.push(m);
    t.machineId = m.id;
  } else if (kind === "farm") {
    const f: Farm = { tx, ty, growth: 0, ripe: false };
    world.farms.push(f);
    t.machineId = world.farms.length - 1;
  } else if (kind === "refinery") {
    world.refineries.push({ tx, ty });
    t.machineId = world.refineries.length - 1;
  }

  return kind;
}

// Ore->material refine step (one completed refinery job). Consumes REFINE_ORE_PER_MATERIAL
// ore and banks one material. Returns false if there was not enough ore.
export function canRefine(stocks: Stocks): boolean {
  return stocks.ore >= REFINE_ORE_PER_MATERIAL;
}
export function doRefine(stocks: Stocks): boolean {
  if (!canRefine(stocks)) return false;
  stocks.ore -= REFINE_ORE_PER_MATERIAL;
  stocks.material += 1;
  return true;
}

// Grow every planted farm toward ripeness. A ripe plot is harvested by a delver (src/sim.ts
// queues the harvest job).
export function growFarms(world: World, dt: number): void {
  for (const f of world.farms) {
    if (f.ripe) continue;
    f.growth += dt;
    if (f.growth >= FARM_GROW_TIME) {
      f.growth = FARM_GROW_TIME;
      f.ripe = true;
    }
  }
}

// Harvest a ripe plot: bank food and reset it to grow again (specs/economy.md).
export function harvest(stocks: Stocks, farm: Farm): void {
  stocks.food += HARVEST_YIELD;
  farm.ripe = false;
  farm.growth = 0;
}

// Top up generator fuel from the colony's ore stock. A generator burns 1 ore / 12 s; we
// refuel one buffered ore-unit whenever its buffer is nearly spent and ore is on hand, so a
// generator keeps running while the colony mines ore and starves when the ore runs out
// (specs/power.md, and stated in the README). Bounded by GEN_FUEL_MAX.
export function refuelGenerators(world: World, stocks: Stocks): void {
  for (const m of world.machines) {
    if (m.kind !== "generator") continue;
    if (m.fuel < 1 && m.fuel < GEN_FUEL_MAX && stocks.ore > 0) {
      stocks.ore -= 1;
      m.fuel = Math.min(GEN_FUEL_MAX, m.fuel + 1);
    }
  }
}

// The farm record backing a farm tile (via its machineId), for the harvest job / render.
export function farmAt(world: World, tx: number, ty: number): Farm | null {
  const t = tileAt(world, tx, ty);
  if (!t || t.kind !== "farm") return null;
  return world.farms[t.machineId] ?? null;
}

// The machine record backing a machine tile (via its machineId).
export function machineAt(world: World, tx: number, ty: number): Machine | null {
  const t = tileAt(world, tx, ty);
  if (!t || !isMachine(t.kind) || t.kind === "farm") return null;
  return world.machines[t.machineId] ?? null;
}
