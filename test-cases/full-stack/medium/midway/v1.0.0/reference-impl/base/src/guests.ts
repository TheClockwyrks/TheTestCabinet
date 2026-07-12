// Midway — guest AI helpers (specs/guests.md; DESIGN.md §2). The signature system: a
// guest carries a vector of decaying DESIRES + a wallet + a happiness, and each time it
// is free it weighs its most pressing desire against the reachable, affordable attractions
// that serve it and heads there. This module is pure — desire growth, target choice,
// price-vs-value judgment, queue tolerance, happiness clamping, and the leave decision —
// and holds no state; the Game (sim.ts) owns the guests and applies movement + transitions.

import { TUNE } from "./constants";
import type { DesireKey } from "./constants";
import { tileAt } from "./park";
import type { Attraction, Cell, Guest, World } from "./types";

// Overprice tolerance: at/under value is a happy buy; up to this multiple of value is a
// grudging buy (a small mood hit); above it the guest refuses (specs/guests.md).
const OVERPRICE_TOLERANCE = 1.35;
// A desire this low is not worth acting on yet.
const ACT_THRESHOLD = 22;

// ---- Desire growth (needs rise over time; energy is drained by walking, in sim) ---
export function stepDesires(g: Guest, dt: number): void {
  const day = dt / TUNE.daySeconds;
  const grow = TUNE.guests.desireGrowth;
  bump(g, "thrill", grow.thrill * day);
  bump(g, "hunger", grow.hunger * day);
  bump(g, "thirst", grow.thirst * day + (g.thirstBoostTimer > 0 ? TUNE.guests.thirstAfterRide.amount * day : 0));
  bump(g, "bladder", grow.bladder * day + (g.bladderBoostTimer > 0 ? TUNE.guests.bladderAfterDrink.amount * day : 0));
  g.thirstBoostTimer = Math.max(0, g.thirstBoostTimer - dt);
  g.bladderBoostTimer = Math.max(0, g.bladderBoostTimer - dt);
}

function bump(g: Guest, key: DesireKey, amount: number): void {
  g.desires[key] = Math.max(0, Math.min(100, g.desires[key] + amount));
}

export function applyHappiness(g: Guest, delta: number): void {
  g.happiness = Math.max(0, Math.min(100, g.happiness + delta));
}

// ---- Value + price judgment ------------------------------------------------------
// An attraction's perceived value in money units (specs/guests.md): thrill/quality,
// reduced by a long queue, a breakdown, and a dirty/unappealing setting at its entrance.
export function perceivedValue(a: Attraction, world: World): number {
  const entrance = tileAt(world, a.entrance.col, a.entrance.row);
  const litter = entrance ? entrance.litter : 0;
  const filthFactor = 1 - 0.4 * litter;
  if (a.category === "ride") {
    if (a.state === "broken") return 0;
    const base = 2 + a.thrill * 0.15;
    const queueFactor = Math.max(0.35, 1 - a.queue.length / (a.capacity * 2.5));
    return base * queueFactor * filthFactor;
  }
  // Stalls: food/drink solid, restroom cheap-and-needed, souvenir tracks the good mood.
  let base: number;
  if (a.serves === "souvenir") base = 4;
  else if (a.serves === "bladder") base = 2;
  else base = 7;
  const queueFactor = Math.max(0.4, 1 - a.queue.length / 6);
  return base * queueFactor * filthFactor;
}

// How the guest reads this ride/stall's price against its value: happy (<= value),
// grudging (up to the tolerance), or refuse.
export type PriceVerdict = "happy" | "grudging" | "refuse";
export function judgePrice(price: number, value: number): PriceVerdict {
  if (price <= value) return "happy";
  if (price <= value * OVERPRICE_TOLERANCE) return "grudging";
  return "refuse";
}

// Would the guest buy here at all: it can afford the price and does not refuse the deal.
export function willBuy(g: Guest, a: Attraction, world: World): boolean {
  if (g.wallet < a.price) return false;
  const souvenir = a.serves === "souvenir";
  // A souvenir is a happy-mood want; a grumpy guest won't splurge on one.
  if (souvenir && g.happiness < 55) return false;
  return judgePrice(a.price, perceivedValue(a, world)) !== "refuse";
}

// Admission judgment at the gate: affordable, and fair enough given the park's rating
// (a poorly-rated, pricey gate turns guests away — specs/guests.md).
export function judgeAdmission(price: number, wallet: number, rating: number): boolean {
  if (price > wallet) return false;
  const affordability = price / wallet;
  const fairness = 0.35 + rating / 100;
  return fairness >= affordability;
}

// The longest queue this guest will join, growing with its mood (specs/guests.md §4).
export function queueTolerance(happiness: number): number {
  return TUNE.guests.queueBalkBase + happiness * TUNE.guests.queueBalkPerHappy;
}

// Should the guest head home now, and why: too unhappy to stay, out of money, or all
// needs satisfied and content to go.
export function shouldLeave(g: Guest): "angry" | "content" | null {
  if (g.happiness < TUNE.guests.leaveAngryBelow) return "angry";
  if (g.wallet < TUNE.guests.contentWalletBelow) return "content";
  const q = g.desires;
  if (q.thrill < 25 && q.hunger < 25 && q.thirst < 25 && q.bladder < 25) return "content";
  return null;
}

// ---- Choosing what to do ---------------------------------------------------------
export interface RestTile {
  cell: Cell;
  region: number;
}

export interface GuestEnv {
  attractions: Attraction[];
  restTiles: RestTile[];
  world: World;
  reachableAttr(a: Attraction, guestRegion: number): boolean;
}

export type GuestDecision =
  | { kind: "ride" | "stall"; id: number }
  | { kind: "bench"; cell: Cell }
  | { kind: "leave" }
  | { kind: "wander" };

// Weigh the guest's pressing desires against what it can reach + afford, and pick a
// target (or wander / rest / leave). `guestRegion` is the path-graph component the guest
// currently stands on, so it never chooses a stranded attraction (specs/guests.md).
export function chooseAction(g: Guest, guestRegion: number, env: GuestEnv): GuestDecision {
  const leave = shouldLeave(g);
  if (leave) return { kind: "leave" };

  let best: GuestDecision | null = null;
  let bestScore = -1;

  const consider = (decision: GuestDecision, score: number): void => {
    if (score > bestScore) {
      bestScore = score;
      best = decision;
    }
  };

  // Desire-driven targets. Bladder is weighted up hard when it is bursting.
  for (const need of ["bladder", "thirst", "hunger", "thrill"] as const) {
    const level = g.desires[need];
    if (level < ACT_THRESHOLD) continue;
    const target = pickTarget(g, need, guestRegion, env);
    if (!target) continue;
    const urgency = need === "bladder" && level > 70 ? 45 : 0;
    consider(target, level + urgency);
  }

  // Rest: a tired guest seeks the nearest reachable bench-side tile.
  if (g.desires.energy < 35) {
    const rest = nearestRest(g, guestRegion, env.restTiles);
    if (rest) consider({ kind: "bench", cell: rest }, 45 - g.desires.energy + (g.desires.energy < 15 ? 45 : 0));
  }

  // Souvenir impulse: a happy guest with spare cash splurges on a want.
  if (g.happiness > 65 && g.wallet > 15) {
    const souv = pickStallServing(g, "souvenir", guestRegion, env);
    if (souv) consider({ kind: "stall", id: souv }, 28);
  }

  return best ?? { kind: "wander" };
}

// The best reachable, affordable target that serves `need` (a ride for thrill, the right
// stall otherwise). Rides also respect the guest's queue tolerance.
function pickTarget(g: Guest, need: DesireKey, guestRegion: number, env: GuestEnv): GuestDecision | null {
  if (need === "thrill") {
    let bestId = -1;
    let bestVal = -1;
    for (const a of env.attractions) {
      if (a.category !== "ride" || a.state === "broken") continue;
      if (!env.reachableAttr(a, guestRegion)) continue;
      if (a.queue.length > queueTolerance(g.happiness)) continue;
      if (!willBuy(g, a, env.world)) continue;
      const v = perceivedValue(a, env.world);
      if (v > bestVal) {
        bestVal = v;
        bestId = a.id;
      }
    }
    return bestId >= 0 ? { kind: "ride", id: bestId } : null;
  }
  const serves: DesireKey = need; // hunger/thirst/bladder map straight onto a stall serve
  const id = pickStallServing(g, serves, guestRegion, env);
  return id >= 0 ? { kind: "stall", id } : null;
}

// The best reachable, affordable stall whose `serves` matches (a plain -1 when none).
function pickStallServing(g: Guest, serves: string, guestRegion: number, env: GuestEnv): number {
  let bestId = -1;
  let bestVal = -1;
  for (const a of env.attractions) {
    if (a.category !== "stall" || a.serves !== serves) continue;
    if (!env.reachableAttr(a, guestRegion)) continue;
    if (a.queue.length > queueTolerance(g.happiness) + 2) continue;
    if (!willBuy(g, a, env.world)) continue;
    const v = perceivedValue(a, env.world);
    if (v > bestVal) {
      bestVal = v;
      bestId = a.id;
    }
  }
  return bestId;
}

function nearestRest(g: Guest, guestRegion: number, restTiles: RestTile[]): Cell | null {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (const rt of restTiles) {
    if (rt.region !== guestRegion) continue;
    const d = Math.abs(rt.cell.col - g.tile.col) + Math.abs(rt.cell.row - g.tile.row);
    if (d < bestD) {
      bestD = d;
      best = rt.cell;
    }
  }
  return best;
}
