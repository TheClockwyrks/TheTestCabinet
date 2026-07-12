// Valence — wave composition (specs/matter.md "Wave composition", specs/flow.md).
//
// A round is a timed sequence of units released from the inlet, alternating lanes so
// both always carry traffic. Types unlock by round (per the campaign mode's intro
// schedule), counts grow substantially across the run, and the milestone rounds (10,
// 20) fold a Macromass boss into the wave. Reading the coming round's distinct types
// (the next-round preview) and re-shaping the board for them is the between-round game.

import { BOSS_ROUNDS, type MatterType } from "./constants";
import type { Lane } from "./board";
import type { CampaignMode } from "./mode";
import { Rng } from "./rng";

export interface SpawnEvent {
  atMs: number;
  type: MatterType;
  lane: Lane;
}

export interface Wave {
  round: number;
  events: SpawnEvent[];
  durationMs: number;
  types: MatterType[]; // distinct types present, in preview order
  hasBoss: boolean;
}

interface Weighted {
  type: MatterType;
  weight: number;
  unlockRound: number;
}

export function buildWave(round: number, mode: CampaignMode): Wave {
  const rng = new Rng(round * 2654435761 + 12345);
  const intro = mode.introRounds;

  const pool: Weighted[] = (
    [
      { type: "monatom", weight: 5, unlockRound: 1 },
      { type: "swift", weight: 3, unlockRound: intro.swift },
      { type: "dimer", weight: 3, unlockRound: intro.dimer },
      { type: "polymer", weight: 2, unlockRound: intro.polymer },
      { type: "noble", weight: 2, unlockRound: intro.noble },
      { type: "heavy", weight: 2, unlockRound: intro.heavy },
    ] satisfies Weighted[]
  ).filter((w) => round >= w.unlockRound);

  // Counts grow substantially: ~10 at round 1 up toward ~50 by round 20.
  const count = Math.round(8 + round * 2);
  const totalWeight = pool.reduce((a, w) => a + w.weight, 0);

  const picks: MatterType[] = [];
  for (let i = 0; i < count; i++) {
    let r = rng.next() * totalWeight;
    let chosen: MatterType = "monatom";
    for (const w of pool) {
      r -= w.weight;
      if (r <= 0) {
        chosen = w.type;
        break;
      }
    }
    picks.push(chosen);
  }

  // Spawn cadence tightens with the round so late rounds press harder.
  const interval = Math.max(360, 900 - round * 20);
  const events: SpawnEvent[] = [];
  let lane: Lane = 0;
  let t = 600;
  for (const type of picks) {
    events.push({ atMs: Math.round(t + rng.range(-60, 60)), type, lane });
    lane = lane === 0 ? 1 : 0;
    t += interval;
  }

  const hasBoss = BOSS_ROUNDS.includes(round);
  if (hasBoss) {
    // The boss anchors the middle of the wave, on the lane the alternation would give.
    events.push({ atMs: Math.round(t * 0.45), type: "macromass", lane });
  }

  events.sort((a, b) => a.atMs - b.atMs);
  const durationMs = events.length ? events[events.length - 1]!.atMs + 1200 : 1200;

  // Distinct types, in a stable preview order.
  const order: MatterType[] = ["monatom", "swift", "dimer", "polymer", "noble", "heavy", "macromass"];
  const present = new Set(events.map((e) => e.type));
  const types = order.filter((t2) => present.has(t2));

  return { round, events, durationMs, types, hasBoss };
}
