// Arc Foundry — what each wave releases, and when (specs/enemies.md).
//
// A wave is a timed sequence of Load units released from the map's entry. The opening
// waves are Motes and Sparks; Clusters and Slugs unlock over the first third; Filaments
// arrive only on every fourth wave; a Dynamo anchors each of the two milestone waves.
// Health scaling belongs to the spawner rather than here, so this module decides the
// type sequence and its cadence and nothing else.
//
// Every draw comes off a stream seeded from the wave number, so a wave plays the same
// composition each time it is reached and composing wave `n` never disturbs the run's
// own generators.

import { LOAD_TYPES, type Difficulty, type LoadType } from "./constants";
import { next, range, stream } from "./rng";
import { LOAD_BY_TYPE, isMilestoneWave } from "./tables";
import type { SpawnEvent, Wave } from "./types";

/** One entry of the draw pool, with the wave it first appears on. */
interface Weighted {
  type: LoadType;
  weight: number;
  unlock: number;
}

/** The pool the ground roster is drawn from. Filaments are added separately. */
const POOL: readonly Weighted[] = [
  { type: "mote", weight: 6, unlock: 1 },
  { type: "spark", weight: 4, unlock: 2 },
  { type: "cluster", weight: 3, unlock: 5 },
  { type: "slug", weight: 2, unlock: 6 },
];

/**
 * The base health a set of spawns carries, before the per-wave scaling multiplies it.
 *
 * Every type scales by the same factor of the wave, so comparing base pools compares
 * the scaled pools the growth rule is stated over.
 */
function basePool(events: readonly SpawnEvent[]): number {
  return events.reduce(
    (total, e) => total + LOAD_BY_TYPE[e.type].baseHealth,
    0,
  );
}

/**
 * The floor a wave's base pool must reach: the largest raw draw any wave up to this one
 * produced.
 *
 * Topping every wave up to that running maximum makes the sequence of pools
 * non-decreasing, which is what keeps the wave after a milestone pressing as hard as
 * the milestone itself.
 */
function requiredBase(wave: number, diff: Difficulty): number {
  let most = 0;
  for (let w = 1; w <= wave; w++)
    most = Math.max(most, basePool(rawMix(w, diff)));
  return most;
}

/** Compose a wave. Deterministic in the wave number and the difficulty. */
export function buildWave(wave: number, diff: Difficulty): Wave {
  const events = rawMix(wave, diff);

  // Top the wave up to the floor with the two opening types, spread across the span it
  // already occupies so the reinforcement arrives with the rest rather than in a lump.
  const floor = requiredBase(wave, diff);
  const span = events.length ? events[events.length - 1]!.atMs : 1000;
  const topUp = stream(wave * 2246822519 + 7919);
  let short = floor - basePool(events);
  let n = 0;
  while (short > 0) {
    const type: LoadType = n % 3 === 2 ? "spark" : "mote";
    events.push({
      atMs: Math.round(600 + next(topUp) * Math.max(600, span - 600)),
      type,
    });
    short -= LOAD_BY_TYPE[type].baseHealth;
    n++;
  }

  events.sort((a, b) => a.atMs - b.atMs);
  const durationMs = events.length
    ? events[events.length - 1]!.atMs + 1500
    : 1500;

  const present = new Set(events.map((e) => e.type));
  const types = LOAD_TYPES.filter((t) => present.has(t));
  return {
    wave,
    events,
    durationMs,
    types,
    hasBoss: isMilestoneWave(wave, diff),
    hasAir: wave % 4 === 0,
  };
}

/** The wave's own draw, before the growth floor tops it up. */
function rawMix(wave: number, diff: Difficulty): SpawnEvent[] {
  const rng = stream(wave * 2654435761 + 40503);
  const pool = POOL.filter((w) => wave >= w.unlock);

  const mid = Math.round(diff.waves / 2);
  // Counts grow across the run, and the back half grows faster, so a late wave keeps
  // pressing a fully built yard. Health scales separately.
  const count = Math.round(8 + wave * 1.5 + Math.max(0, wave - mid) * 1.0);
  const totalWeight = pool.reduce((a, w) => a + w.weight, 0);

  // The cadence tightens with the wave, so later waves arrive closer together.
  const interval = Math.max(300, 820 - wave * 14);
  const events: SpawnEvent[] = [];
  let t = 600;
  for (let i = 0; i < count; i++) {
    let r = next(rng) * totalWeight;
    let chosen: LoadType = "mote";
    for (const w of pool) {
      r -= w.weight;
      if (r <= 0) {
        chosen = w.type;
        break;
      }
    }
    if (chosen === "cluster") {
      // Clusters arrive in tight packs at one slot rather than singly.
      const pack = wave >= 12 ? 4 : 3;
      for (let j = 0; j < pack; j++)
        events.push({ atMs: Math.round(t + j * 140), type: "cluster" });
    } else {
      events.push({ atMs: Math.round(t + range(rng, -50, 50)), type: chosen });
    }
    t += interval;
  }

  // The air contingent: Filaments appear on every fourth wave and on no other. The
  // count grows with the wave and they are spaced across it.
  if (wave % 4 === 0) {
    const airCount = Math.round(2 + wave * 0.35);
    const airInterval = Math.max(260, interval * 0.7);
    let at = 900;
    for (let i = 0; i < airCount; i++) {
      events.push({ atMs: Math.round(at), type: "filament" });
      at += airInterval;
    }
  }

  // The Dynamo anchors the middle of a milestone wave, so it crosses under the
  // pressure of the rest rather than alone.
  if (isMilestoneWave(wave, diff)) {
    events.push({ atMs: Math.round(t * 0.5), type: "dynamo" });
  }

  return events;
}
