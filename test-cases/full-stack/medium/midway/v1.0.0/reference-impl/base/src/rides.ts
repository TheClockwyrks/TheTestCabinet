// Midway — ride + stall cycle helpers (specs/rides.md; DESIGN.md §2). The load->run->
// unload state machine for rides, stall selling, throughput, breakdown accrual + queue
// drain, and litter emission. Pure over an Attraction plus a small RideCtx the Game
// (sim.ts) supplies (booking income, cues, fx, litter, guest lookup); it applies the
// concrete effects on riders/buyers directly so sim only owns movement + choice.

import { RIDES, TILE, TUNE } from "./constants";
import type { RideKind } from "./constants";
import { applyHappiness, judgePrice, perceivedValue } from "./guests";
import { tileCenter } from "./park";
import type { Attraction, Cue, FxKind, Guest, World } from "./types";
import type { Rng } from "./rng";

export interface RideCtx {
  world: World;
  guestById(id: number): Guest | undefined;
  earn(amount: number): void;
  snd(cue: Cue): void;
  fx(kind: FxKind, x: number, y: number): void;
  addLitter(col: number, row: number, amt: number): void;
  rng: Rng;
}

// Guests/minute an attraction can clear (capacity over a full load+run cycle) — surfaced
// on the inspector panel and used by the balance harness.
export function throughputOf(a: Attraction): number {
  if (a.category === "stall") return 60 / TUNE.stalls.serveTime;
  const cycle = a.rideDuration + TUNE.rides.loadTime;
  return (a.capacity / cycle) * 60;
}

// Advance one attraction on the tick. Rides walk the idle->loading->running machine and
// accrue breakdowns; stalls sell on a cadence. Both freeze their animation when not active.
export function stepAttraction(a: Attraction, dt: number, ctx: RideCtx): void {
  if (a.category === "stall") {
    stepStall(a, dt, ctx);
    return;
  }
  a.inspectTimer += dt;
  switch (a.state) {
    case "broken":
      break; // waits for a mechanic (staff.ts drives brokenTimer + repair)
    case "idle":
      if (a.connected && a.queue.length > 0) {
        a.state = "loading";
        a.loadTimer = TUNE.rides.loadTime;
      }
      break;
    case "loading":
      a.animT += dt;
      a.loadTimer -= dt;
      if (a.loadTimer <= 0) {
        const boarded = tryLoad(a, ctx);
        if (boarded > 0) {
          a.state = "running";
          a.runTimer = a.rideDuration;
          ctx.snd("ding");
        } else {
          a.state = "idle";
        }
      }
      break;
    case "running":
      a.animT += dt;
      a.runTimer -= dt;
      if (a.runTimer <= 0) {
        unload(a, ctx);
        const broke = accrueBreakdown(a);
        if (broke) breakDown(a, ctx);
        else a.state = "idle";
      }
      break;
    case "unloading":
      a.state = "idle";
      break;
  }
}

// Board up to capacity from the front of the queue, charging each rider the ticket price
// (specs/economy.md). Returns how many boarded.
export function tryLoad(a: Attraction, ctx: RideCtx): number {
  let boarded = 0;
  while (a.riders.length < a.capacity && a.queue.length > 0) {
    const id = a.queue.shift()!;
    const g = ctx.guestById(id);
    if (!g || g.state !== "queuing") continue;
    const paid = Math.min(a.price, Math.max(0, g.wallet));
    g.wallet -= paid;
    ctx.earn(paid);
    recordTakings(a, paid);
    g.state = "riding";
    g.actTimer = a.rideDuration;
    a.riders.push(id);
    boarded++;
  }
  if (boarded > 0) ctx.snd("coin");
  return boarded;
}

// Finish a run: riders leave more thrilled and happier (less if they waited a long time),
// their thrill sated and a post-ride thirst kindled, and rejoin the crowd at the entrance.
function unload(a: Attraction, ctx: RideCtx): void {
  const t = TUNE.guests;
  for (const id of a.riders) {
    const g = ctx.guestById(id);
    if (!g) continue;
    const waitOver = Math.max(0, g.waitTimer - t.patience);
    const gain = t.rideHappyBase + a.thrill * t.rideHappyPerThrill - waitOver * 0.5;
    applyHappiness(g, gain);
    g.desires.thrill = Math.max(0, g.desires.thrill - (a.thrill * 1.2 + 20));
    g.thirstBoostTimer = t.thirstAfterRide.seconds;
    releaseToEntrance(g, a);
  }
  a.riders = [];
}

// Accrue breakdown after a completed run, scaled by how long since a mechanic inspected
// it (specs/rides.md §4). Returns true when it crosses the threshold and should break.
export function accrueBreakdown(a: Attraction): boolean {
  const rate = RIDES[a.kind as RideKind].breakdownRate;
  a.breakdownAccum += rate * (1 + a.inspectTimer / TUNE.rides.inspectAgeScale);
  return a.breakdownAccum >= TUNE.rides.breakThreshold;
}

// Break a ride: it stops, its waiting queue drains away in frustration, and it flags an
// alarm (specs/rides.md, specs/flow.md).
export function breakDown(a: Attraction, ctx: RideCtx): void {
  a.state = "broken";
  a.brokenTimer = 0;
  drainQueue(a, ctx, TUNE.guests.queueWaitPenalty * 6);
  ctx.snd("alarm");
  const c = centerPx(a);
  ctx.fx("cleanup", c.x, c.y); // a puff of "out of order" smoke over the stopped ride
}

// A mechanic patrol inspection: resets the since-inspected clock and shaves the accrued
// breakdown, so a maintained ride breaks less (specs/staff.md).
export function inspectRide(a: Attraction): void {
  a.inspectTimer = 0;
  a.breakdownAccum = Math.max(0, a.breakdownAccum * (1 - TUNE.rides.inspectShave));
}

// A mechanic finished a repair: the ride runs again with a clean maintenance slate.
export function repairRide(a: Attraction): void {
  a.state = "idle";
  a.breakdownAccum = 0;
  a.brokenTimer = 0;
  a.inspectTimer = 0;
}

// ---- Stalls ----------------------------------------------------------------------
function stepStall(a: Attraction, dt: number, ctx: RideCtx): void {
  if (a.connected && a.queue.length > 0) {
    a.animT += dt; // steam/serving animation runs while a line is being served
    a.sellTimer += dt;
    if (a.sellTimer >= TUNE.stalls.serveTime) {
      a.sellTimer -= TUNE.stalls.serveTime;
      sellAt(a, ctx);
    }
  } else {
    a.sellTimer = 0;
  }
}

// Sell to the front buyer: it pays, its served desire drops, its mood moves by how fair
// the price was, and litter is dropped on nearby path tiles (specs/rides.md, specs/staff.md).
export function sellAt(a: Attraction, ctx: RideCtx): void {
  const id = a.queue.shift();
  if (id === undefined) return;
  const g = ctx.guestById(id);
  if (!g || g.state !== "buying") return;
  const paid = Math.min(a.price, Math.max(0, g.wallet));
  g.wallet -= paid;
  ctx.earn(paid);
  recordTakings(a, paid);

  const verdict = judgePrice(a.price, perceivedValue(a, ctx.world));
  const t = TUNE.guests;
  if (verdict === "happy") applyHappiness(g, t.buyHappy);
  else applyHappiness(g, t.buyHappy * 0.2 - t.overpricePenalty * 0.3);

  if (a.serves === "souvenir") {
    applyHappiness(g, t.buyHappy * 0.5); // a want, not a need — pure mood
  } else {
    g.desires[a.serves] = Math.max(0, g.desires[a.serves] - t.saleReduce);
    if (a.serves === "thirst") g.bladderBoostTimer = t.bladderAfterDrink.seconds;
  }
  ctx.snd("coin");
  emitLitter(a, ctx);
  releaseToEntrance(g, a);
}

function emitLitter(a: Attraction, ctx: RideCtx): void {
  const n = ctx.rng.int(TUNE.stalls.litterTilesMin, TUNE.stalls.litterTilesMax);
  const spots: [number, number][] = [
    [a.entrance.col, a.entrance.row],
    [a.entrance.col + 1, a.entrance.row],
    [a.entrance.col - 1, a.entrance.row],
    [a.entrance.col, a.entrance.row + 1],
    [a.entrance.col, a.entrance.row - 1],
  ];
  for (let i = 0; i < n && i < spots.length; i++) {
    ctx.addLitter(spots[i]![0], spots[i]![1], TUNE.stalls.litterAdd);
  }
}

// ---- Shared ----------------------------------------------------------------------
function drainQueue(a: Attraction, ctx: RideCtx, penalty: number): void {
  for (const id of a.queue) {
    const g = ctx.guestById(id);
    if (!g) continue;
    applyHappiness(g, -penalty);
    releaseToEntrance(g, a);
  }
  a.queue = [];
}

// Put a guest back onto the crowd at the attraction's entrance to re-decide.
function releaseToEntrance(g: Guest, a: Attraction): void {
  const c = tileCenter(a.entrance);
  g.x = c.x;
  g.y = c.y;
  g.tile = { col: a.entrance.col, row: a.entrance.row };
  g.path = [];
  g.pathIdx = 0;
  g.state = "wandering";
  g.targetKind = "none";
  g.targetId = -1;
  g.waitTimer = 0;
  g.actTimer = 0;
}

function recordTakings(a: Attraction, amount: number): void {
  a.takings += amount;
  a.takingsWindow.push(amount);
  if (a.takingsWindow.length > 20) a.takingsWindow.shift();
}

function centerPx(a: Attraction): { x: number; y: number } {
  return { x: (a.col + a.w / 2) * TILE, y: (a.row + a.h / 2) * TILE };
}
