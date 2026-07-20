// Valence — wave composition (specs/matter.md "Wave composition", specs/flow.md).
//
// A round is a timed sequence of units released from the inlet(s), distributed round-robin
// across the map's paths so every path always carries traffic (specs/board.md). Types
// unlock by round (per the campaign mode's intro schedule) — atoms first, then bonded and
// inert and heavy matter, and finally the trait COMBOS (inert+bonded, inert+heavy) that
// force layered defenses. Counts grow substantially across the run, and the milestone
// rounds (10, 20) fold a Macromass boss into the wave. Reading the coming round's distinct
// types (the next-round preview) and re-shaping the board for them is the between-round game.

import { BOSS_ROUNDS, atomElectronRange, type MatterType } from "./constants";
import type { Lane } from "./board";
import type { CampaignMode } from "./mode";
import { Rng } from "./rng";

export interface SpawnEvent {
  atMs: number;
  type: MatterType;
  lane: Lane;
  electrons?: number; // a regular atom's electron count = its hit points (specs/matter.md)
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

export function buildWave(round: number, mode: CampaignMode, pathCount = 2): Wave {
  const rng = new Rng(round * 2654435761 + 12345);
  const intro = mode.introRounds;
  const lanes = Math.max(1, pathCount);
  const [eLo, eHi] = atomElectronRange(round); // this round's regular-atom electron window

  const pool: Weighted[] = (
    [
      { type: "atom", weight: 6, unlockRound: 1 },
      { type: "dimer", weight: 3, unlockRound: intro.dimer },
      { type: "noble", weight: 2, unlockRound: intro.noble },
      { type: "polymer", weight: 2, unlockRound: intro.polymer },
      { type: "heavy", weight: 2, unlockRound: intro.heavy },
      { type: "chelate", weight: 2, unlockRound: intro.chelate },
      { type: "shroud", weight: 2, unlockRound: intro.shroud },
    ] satisfies Weighted[]
  ).filter((w) => round >= w.unlockRound);

  // Counts grow substantially: ~10 at round 1 up toward ~60 by round 20, with the back
  // third getting denser still so the late rounds keep pressing a fully-built board.
  const count = Math.round(8 + round * 2 + Math.max(0, round - 11) * 1.3);
  const totalWeight = pool.reduce((a, w) => a + w.weight, 0);

  const picks: { type: MatterType; electrons?: number }[] = [];
  for (let i = 0; i < count; i++) {
    let r = rng.next() * totalWeight;
    let chosen: MatterType = "atom";
    for (const w of pool) {
      r -= w.weight;
      if (r <= 0) {
        chosen = w.type;
        break;
      }
    }
    let electrons: number | undefined;
    if (chosen === "atom") {
      // Size the atom within the round's window, weighted toward the top (max of two rolls)
      // so waves escalate — early rounds are small atoms, late rounds the full 6-electron.
      const t = Math.max(rng.next(), rng.next());
      electrons = eLo + Math.floor(t * (eHi - eLo + 1));
    }
    picks.push({ type: chosen, electrons });
  }

  // Spawn cadence tightens with the round so late rounds press harder.
  const interval = Math.max(360, 900 - round * 20);
  const events: SpawnEvent[] = [];
  let lane: Lane = 0;
  let t = 600;
  for (const pick of picks) {
    events.push({ atMs: Math.round(t + rng.range(-60, 60)), type: pick.type, lane, electrons: pick.electrons });
    lane = (lane + 1) % lanes; // round-robin across the map's paths — every path carries traffic
    t += interval;
  }

  const hasBoss = BOSS_ROUNDS.includes(round);
  if (hasBoss) {
    // The boss anchors the middle of the wave, on the path the round-robin would give.
    events.push({ atMs: Math.round(t * 0.45), type: "macromass", lane });
  }

  events.sort((a, b) => a.atMs - b.atMs);
  const durationMs = events.length ? events[events.length - 1]!.atMs + 1200 : 1200;

  // Distinct types, in a stable preview order.
  const order: MatterType[] = ["atom", "dimer", "polymer", "noble", "heavy", "chelate", "shroud", "macromass"];
  const present = new Set(events.map((e) => e.type));
  const types = order.filter((t2) => present.has(t2));

  return { round, events, durationMs, types, hasBoss };
}
