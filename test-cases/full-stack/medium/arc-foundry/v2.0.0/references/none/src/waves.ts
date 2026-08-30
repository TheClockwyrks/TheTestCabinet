// Arc Foundry — wave composition (specs/enemies.md, specs/campaign.md).
//
// A wave is a timed sequence of Load units released from the map's single Entry
// (specs/yard.md). Early waves are mostly Motes and Sparks; mid waves add Clusters
// (splash/chain answer) and Slugs (heavy single-hit answer); late waves press dense mixes.
// FILAMENTS (the flyer) appear ONLY on every fourth wave (w % 4 === 0), never otherwise
// (specs/enemies.md). Milestone waves (round(N/2) and N) fold in a Dynamo boss
// (specs/campaign.md). HP scaling is applied per-unit at spawn from the difficulty
// (specs/enemies.md), NOT here — this module only picks the type sequence and timing,
// seeded per wave so a given wave plays the same each time it is reached.

import {
  LOAD,
  LOAD_ORDER,
  isMilestoneWave,
  type DifficultyDef,
} from "./constants";
import { Rng } from "./rng";
import type { LoadType, SpawnEvent, Wave } from "./types";

// A weighted entry in the wave's spawn pool, gated by the wave it first appears on.
interface Weighted {
  type: LoadType;
  weight: number;
  unlock: number;
}

// Compose wave `wave` of `diff.waves` for the chosen difficulty. Deterministic in
// (wave, diff): the type mix, counts, spawn cadence, and whether a Dynamo anchors it.
// The base health a set of spawns carries, before the per-wave scaling multiplies it. Since
// every type scales by the same factor of the wave, comparing base pools compares the scaled
// pools the Growth rule of specs/enemies.md is stated over.
function basePool(events: SpawnEvent[]): number {
  return events.reduce((total, e) => total + LOAD[e.type].baseHp, 0);
}

// The floor a wave's base pool must reach: the largest raw draw any wave up to this one
// produced. Topping every wave up to that running maximum makes the sequence of pools
// non-decreasing, which is the Growth rule of specs/enemies.md, and it is what makes the
// wave after a milestone press as hard as the milestone itself.
function requiredBase(wave: number, diff: DifficultyDef): number {
  let most = 0;
  for (let w = 1; w <= wave; w++)
    most = Math.max(most, basePool(rawMix(w, diff)));
  return most;
}

export function buildWave(wave: number, diff: DifficultyDef): Wave {
  const events = rawMix(wave, diff);
  // Top the wave up to the floor with the two opening types, spread across the span it
  // already occupies so the reinforcement arrives with the rest rather than in a lump.
  const floor = requiredBase(wave, diff);
  const span = events.length ? events[events.length - 1]!.atMs : 1000;
  const topUp = new Rng(wave * 2246822519 + 7919);
  let short = floor - basePool(events);
  let n = 0;
  while (short > 0) {
    const type: LoadType = n % 3 === 2 ? "spark" : "mote";
    events.push({
      atMs: Math.round(600 + topUp.next() * Math.max(600, span - 600)),
      type,
    });
    short -= LOAD[type].baseHp;
    n++;
  }

  events.sort((a, b) => a.atMs - b.atMs);
  const durationMs = events.length
    ? events[events.length - 1]!.atMs + 1500
    : 1500;

  // Distinct types present, in the stable roster order (the next-wave preview).
  const present = new Set(events.map((e) => e.type));
  const types = LOAD_ORDER.filter((t2) => present.has(t2));
  const hasBoss = isMilestoneWave(wave, diff);
  return { wave, events, durationMs, types, hasBoss, hasAir: wave % 4 === 0 };
}

// The wave's own draw, before the Growth floor tops it up.
function rawMix(wave: number, diff: DifficultyDef): SpawnEvent[] {
  const rng = new Rng(wave * 2654435761 + 40503);

  // Unlock thresholds are small fixed wave numbers (every difficulty runs ≥ 20 waves): the
  // GROUND roster fills in over the opening third — Motes/Sparks, then Clusters, Slugs.
  // Filaments are NOT in this pool; they are added as a fixed contingent every 4th wave below.
  const pool: Weighted[] = (
    [
      { type: "mote", weight: 6, unlock: 1 },
      { type: "spark", weight: 4, unlock: 2 },
      { type: "cluster", weight: 3, unlock: 5 },
      { type: "slug", weight: 2, unlock: 6 },
    ] satisfies Weighted[]
  ).filter((w) => wave >= w.unlock);

  const mid = Math.round(diff.waves / 2);
  // Counts grow across the run, and the back half gets denser so late waves keep pressing a
  // fully-built board. HP scales separately (specs/enemies.md), so counts stay GemTD-scale.
  const count = Math.round(8 + wave * 1.5 + Math.max(0, wave - mid) * 1.0);
  const totalWeight = pool.reduce((a, w) => a + w.weight, 0);

  // Spawn cadence tightens with the wave so later waves press harder.
  const interval = Math.max(300, 820 - wave * 14);
  const events: SpawnEvent[] = [];
  let t = 600;
  for (let i = 0; i < count; i++) {
    let r = rng.next() * totalWeight;
    let chosen: LoadType = "mote";
    for (const w of pool) {
      r -= w.weight;
      if (r <= 0) {
        chosen = w.type;
        break;
      }
    }
    if (chosen === "cluster") {
      // Clusters arrive in dense packs (specs/enemies.md) — a tight burst at one slot.
      const pack = wave >= 12 ? 4 : 3;
      for (let j = 0; j < pack; j++)
        events.push({ atMs: Math.round(t + j * 140), type: "cluster" });
    } else {
      events.push({ atMs: Math.round(t + rng.range(-50, 50)), type: chosen });
    }
    t += interval;
  }

  // Air contingent: Filaments appear ONLY on every fourth wave (specs/enemies.md). The count
  // grows with the wave; they are spaced across the wave near the straight-line flyer path.
  const hasAir = wave % 4 === 0;
  if (hasAir) {
    const airCount = Math.round(2 + wave * 0.35);
    const airInterval = Math.max(260, interval * 0.7);
    let at = 900;
    for (let i = 0; i < airCount; i++) {
      events.push({ atMs: Math.round(at), type: "filament" });
      at += airInterval;
    }
  }

  const hasBoss = isMilestoneWave(wave, diff);
  if (hasBoss) {
    // The Dynamo anchors the middle of the wave so it crosses under the pressure of the rest.
    events.push({ atMs: Math.round(t * 0.5), type: "dynamo" });
  }

  return events;
}
