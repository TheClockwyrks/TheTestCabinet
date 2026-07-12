// Midway — staff behaviour (specs/staff.md; DESIGN.md §2). Janitors seek + clear litter
// (throwing a cleanup puff), mechanics repair broken rides and inspect on patrol, and
// entertainers roam lifting the mood of guests nearby. Staff pathfind the same walkable
// graph as guests, restricted to a zone when assigned or roaming the whole connected park
// otherwise. Pure over a Staff plus a StaffCtx the Game (sim.ts) supplies.

import { TUNE } from "./constants";
import { applyHappiness } from "./guests";
import { advancePath, idx, regionAt, tileAt } from "./park";
import { inspectRide, repairRide } from "./rides";
import type { Attraction, Cell, Cue, FxKind, Guest, Staff, StaffZone, World } from "./types";
import type { Rng } from "./rng";

export interface StaffCtx {
  world: World;
  attractions: Attraction[];
  guests: Guest[];
  findPath(from: Cell, to: Cell): Cell[] | null;
  fx(kind: FxKind, x: number, y: number): void;
  snd(cue: Cue): void;
  spend(amount: number): void;
  rng: Rng;
}

// Total daily wages for the whole roster (specs/economy.md) — the HUD wage bill.
export function wageBill(staff: Staff[]): number {
  return staff.reduce((sum, s) => sum + s.wage, 0);
}

export function assignZone(s: Staff, zone: StaffZone | null): void {
  s.zone = zone;
  s.state = "idle";
  s.path = [];
  s.pathIdx = 0;
  s.targetId = -1;
}

export function stepStaff(s: Staff, dt: number, ctx: StaffCtx): void {
  if (s.state === "walking") s.animT += dt;
  switch (s.kind) {
    case "janitor":
      stepJanitor(s, dt, ctx);
      break;
    case "mechanic":
      stepMechanic(s, dt, ctx);
      break;
    case "entertainer":
      stepEntertainer(s, dt, ctx);
      break;
  }
}

// ---- Janitor ---------------------------------------------------------------------
function stepJanitor(s: Staff, dt: number, ctx: StaffCtx): void {
  switch (s.state) {
    case "idle": {
      const litter = findLitterTarget(s, ctx);
      if (litter) {
        routeTo(s, litter, ctx, idx(litter.col, litter.row));
      } else {
        patrol(s, ctx); // nothing to clean: wander the zone/park
      }
      break;
    }
    case "walking":
      if (arrive(s, dt)) {
        const tile = tileAt(ctx.world, s.tile.col, s.tile.row);
        if (s.targetId >= 0 && tile && tile.litter > 0.02) {
          s.state = "working";
          s.workTimer = TUNE.staff.janitorClearTime;
        } else {
          s.state = "idle";
        }
      }
      break;
    case "working":
      s.workTimer -= dt;
      if (s.workTimer <= 0) {
        const tile = tileAt(ctx.world, s.tile.col, s.tile.row);
        if (tile) tile.litter = 0;
        ctx.fx("cleanup", s.x, s.y);
        s.state = "idle";
        s.targetId = -1;
      }
      break;
  }
}

// The highest-litter reachable path tile within the janitor's zone (or the whole
// connected park when roaming), or null if the park is clean.
export function findLitterTarget(s: Staff, ctx: StaffCtx): Cell | null {
  const region = regionAt(ctx.world, s.tile.col, s.tile.row);
  let best: Cell | null = null;
  let bestLitter = 0.05;
  const w = ctx.world;
  for (let row = 0; row < w.rows; row++) {
    for (let col = 0; col < w.cols; col++) {
      const t = w.tiles[idx(col, row)]!;
      if (t.kind !== "path" || t.region !== region || t.litter <= bestLitter) continue;
      if (!inZone(col, row, s.zone)) continue;
      bestLitter = t.litter;
      best = { col, row };
    }
  }
  return best;
}

// ---- Mechanic --------------------------------------------------------------------
function stepMechanic(s: Staff, dt: number, ctx: StaffCtx): void {
  switch (s.state) {
    case "idle": {
      const broken = findBrokenRide(s, ctx);
      if (broken && broken.entrance) {
        routeTo(s, broken.entrance, ctx, broken.id);
      } else {
        const ride = pickRideToInspect(s, ctx);
        if (ride) routeTo(s, ride.entrance, ctx, ride.id);
        else patrol(s, ctx);
      }
      break;
    }
    case "walking":
      if (arrive(s, dt)) {
        const ride = ctx.attractions.find((a) => a.id === s.targetId);
        if (ride && ride.category === "ride") {
          s.state = "working";
          s.workTimer = ride.state === "broken" ? TUNE.rides.repairTime : 1.0;
        } else {
          s.state = "idle";
          s.targetId = -1;
        }
      }
      break;
    case "working": {
      s.workTimer -= dt;
      const ride = ctx.attractions.find((a) => a.id === s.targetId);
      if (ride && ride.state === "broken") ride.brokenTimer += dt; // repair progress for the HUD
      if (s.workTimer <= 0) {
        if (ride && ride.category === "ride") {
          if (ride.state === "broken") {
            repairRide(ride);
            ctx.spend(TUNE.economy.repairFee);
            ctx.snd("ding");
          } else {
            inspectRide(ride);
          }
        }
        s.state = "idle";
        s.targetId = -1;
      }
      break;
    }
  }
}

// The nearest reachable broken ride, or null (specs/rides.md — mechanics prioritize these).
export function findBrokenRide(s: Staff, ctx: StaffCtx): Attraction | null {
  const region = regionAt(ctx.world, s.tile.col, s.tile.row);
  let best: Attraction | null = null;
  let bestD = Infinity;
  for (const a of ctx.attractions) {
    if (a.category !== "ride" || a.state !== "broken" || !a.connected) continue;
    if (regionAt(ctx.world, a.entrance.col, a.entrance.row) !== region) continue;
    if (!inZone(a.entrance.col, a.entrance.row, s.zone)) continue;
    const d = Math.abs(a.entrance.col - s.tile.col) + Math.abs(a.entrance.row - s.tile.row);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

// A reachable ride to patrol-inspect, preferring the one most overdue (specs/staff.md).
function pickRideToInspect(s: Staff, ctx: StaffCtx): Attraction | null {
  const region = regionAt(ctx.world, s.tile.col, s.tile.row);
  let best: Attraction | null = null;
  let bestAge = 8; // don't bother inspecting a freshly-checked ride
  for (const a of ctx.attractions) {
    if (a.category !== "ride" || !a.connected) continue;
    if (regionAt(ctx.world, a.entrance.col, a.entrance.row) !== region) continue;
    if (!inZone(a.entrance.col, a.entrance.row, s.zone)) continue;
    if (a.inspectTimer > bestAge) {
      bestAge = a.inspectTimer;
      best = a;
    }
  }
  return best;
}

// ---- Entertainer -----------------------------------------------------------------
function stepEntertainer(s: Staff, dt: number, ctx: StaffCtx): void {
  // Roam the paths; guests within the aura get a steady mood lift wherever it is.
  const r2 = TUNE.staff.entertainerRadius * TUNE.staff.entertainerRadius;
  for (const g of ctx.guests) {
    const dx = g.x - s.x;
    const dy = g.y - s.y;
    if (dx * dx + dy * dy <= r2) applyHappiness(g, TUNE.guests.entertainerBoost * dt);
  }
  if (s.state === "idle") patrol(s, ctx);
  else if (s.state === "walking" && arrive(s, dt)) s.state = "idle";
}

// ---- Shared movement / patrol ----------------------------------------------------
function routeTo(s: Staff, to: Cell, ctx: StaffCtx, targetId: number): void {
  const path = ctx.findPath(s.tile, to);
  if (!path || path.length <= 1) {
    s.state = "idle";
    s.targetId = -1;
    return;
  }
  s.path = path;
  s.pathIdx = 1; // index 0 is the tile it already stands on
  s.state = "walking";
  s.targetId = targetId;
}

// Wander to a random reachable path tile in the zone/park (keeps staff visibly moving).
function patrol(s: Staff, ctx: StaffCtx): void {
  const region = regionAt(ctx.world, s.tile.col, s.tile.row);
  const w = ctx.world;
  const candidates: Cell[] = [];
  for (let row = 0; row < w.rows; row++) {
    for (let col = 0; col < w.cols; col++) {
      const t = w.tiles[idx(col, row)]!;
      if (t.kind !== "path" || t.region !== region) continue;
      if (!inZone(col, row, s.zone)) continue;
      candidates.push({ col, row });
    }
  }
  if (candidates.length === 0) {
    s.state = "idle";
    return;
  }
  const to = candidates[ctx.rng.int(0, candidates.length - 1)]!;
  routeTo(s, to, ctx, -1);
}

function arrive(s: Staff, dt: number): boolean {
  return advancePath(s, dt).arrived;
}

function inZone(col: number, row: number, zone: StaffZone | null): boolean {
  if (!zone) return true;
  return col >= zone.col && col < zone.col + zone.w && row >= zone.row && row < zone.row + zone.h;
}
