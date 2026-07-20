// Valence — wave composition (specs/matter.md "Wave composition", specs/campaign.md).
//
// A round's composition is FIXED by the round table below, not drawn at random: each row
// lists the round's groups in release order. Groups are released one at a time, and a
// group's units go out back to back at a fixed interval for their type, so matter arrives
// in runs of ONE KIND rather than interleaved. That clumping is the point — a group of
// clusters or isotopes fragments into overlapping sprays, and the density the player pops
// through comes from those cascades, not from the spawn count.
//
// Counts are units SPAWNED, not the pops they produce: one Lattice becomes sixteen free
// atoms the board must finish, and the boss fissions into daughter isotopes as well as
// particles (specs/matter.md). Every unit's total shells is fixed, so a round is made
// harder only by what the table sends and how much of it.

import { BOSS_ROUNDS, TOTAL_ROUNDS, type MatterType } from "./constants";
import type { Lane } from "./board";
import type { CampaignMode } from "./mode";

export interface SpawnEvent {
  atMs: number;
  type: MatterType;
  lane: Lane;
  electrons?: number; // a regular atom's electron count = its hit points (specs/matter.md)
  inert?: boolean; // shielded: untargetable until a detector reveals it
}

export interface Wave {
  round: number;
  events: SpawnEvent[];
  durationMs: number;
  types: MatterType[]; // distinct types present, in preview order
  hasBoss: boolean;
}

/** One group in a round: `n` units of `type`, optionally sized and/or shielded. */
interface Group {
  type: MatterType;
  n: number;
  electrons?: number;
  inert?: boolean;
}

// Group constructors, one per roster entry, so a table row reads as its composition.
const a = (n: number, electrons: number): Group => ({ type: "atom", n, electrons });
const shielded = (n: number, electrons: number): Group => ({ type: "noble", n, electrons, inert: true });
const dimer = (n: number, inert = false): Group => ({ type: "dimer", n, inert });
const isotope = (n: number, inert = false): Group => ({ type: "heavy", n, inert });
const polymer = (n: number, inert = false): Group => ({ type: "polymer", n, inert });
const lattice = (n: number, inert = false): Group => ({ type: "lattice", n, inert });

// The round table (specs/matter.md). Groups are listed in release order.
const WAVE_TABLE: Group[][] = [
  /*  1 */ [a(20, 1)],
  /*  2 */ [a(35, 1)],
  /*  3 */ [a(25, 1), a(5, 2)],
  /*  4 */ [a(35, 1), a(18, 2)],
  /*  5 */ [a(5, 1), a(27, 2)],
  /*  6 */ [a(15, 1), a(15, 2), a(4, 3)],
  /*  7 */ [a(20, 1), a(20, 2), a(5, 3)],
  /*  8 */ [a(10, 1), a(20, 2), a(14, 3)],
  /*  9 */ [a(30, 3)],
  /* 10 */ [a(102, 2)],
  /* 11 */ [a(10, 1), a(10, 2), a(12, 3), a(3, 4)],
  /* 12 */ [a(15, 2), a(10, 3), a(5, 4)],
  /* 13 */ [a(50, 2), a(23, 3)],
  /* 14 */ [a(49, 1), a(15, 2), a(10, 3), a(9, 4)],
  /* 15 */ [a(20, 1), a(15, 2), a(12, 3), a(10, 4), a(5, 5)],
  /* 16 */ [a(40, 3), a(8, 4)],
  /* 17 */ [a(12, 4)],
  /* 18 */ [a(80, 3)],
  /* 19 */ [a(10, 3), a(4, 4), a(5, 4), a(15, 5)],
  /* 20 */ [dimer(6)],
  /* 21 */ [a(40, 4), a(14, 5)],
  /* 22 */ [dimer(16)],
  /* 23 */ [dimer(7), dimer(7)],
  /* 24 */ [a(20, 2), shielded(1, 3)],
  /* 25 */ [a(25, 4), dimer(10)],
  /* 26 */ [a(23, 5), isotope(4)],
  /* 27 */ [a(100, 1), a(60, 2), a(45, 3), a(45, 4)],
  /* 28 */ [isotope(6)],
  /* 29 */ [a(50, 4), a(15, 4)],
  /* 30 */ [isotope(9)],
  /* 31 */ [dimer(8), dimer(8), isotope(8), isotope(2)],
  /* 32 */ [dimer(15), dimer(20), dimer(10)],
  /* 33 */ [shielded(20, 1), shielded(13, 4)],
  /* 34 */ [a(160, 4), isotope(6)],
  /* 35 */ [a(35, 5), dimer(30), dimer(25), polymer(5)],
  /* 36 */ [a(140, 5), shielded(20, 3)],
  /* 37 */ [dimer(25), dimer(25), dimer(7, true), isotope(10), isotope(15)],
  /* 38 */ [a(42, 5), dimer(17), isotope(10), isotope(14), lattice(2)],
  /* 39 */ [dimer(10), dimer(10), isotope(20), polymer(18), polymer(2)],
  /* 40 */ [],
];

// Interval between successive units WITHIN a group (ms), by type (specs/matter.md). Cheap
// atoms stream; fragmenting matter is spaced so its sprays overlap rather than pile up.
const BURST_MS: Record<MatterType, number> = {
  atom: 90,
  noble: 110,
  dimer: 320,
  chelate: 340,
  polymer: 420,
  lattice: 520,
  heavy: 500,
  shroud: 500,
  macromass: 1500,
};

const GROUP_GAP_MS = 900; // gap between successive groups
const MIN_SPAN_MS = 22_000; // shortest a round's release may span; early rounds stretch to it

/** How many Macromass bosses the milestone round `r` folds in (specs/matter.md). */
function bossCount(round: number): number {
  return BOSS_ROUNDS.includes(round) ? 1 : 0;
}

export function buildWave(round: number, _mode: CampaignMode, pathCount = 2): Wave {
  const r = Math.max(1, Math.min(TOTAL_ROUNDS, Math.round(round)));
  const lanes = Math.max(1, pathCount);
  const groups: Group[] = [...(WAVE_TABLE[r - 1] ?? [])];

  const bosses = bossCount(r);
  if (bosses > 0) groups.push({ type: "macromass", n: bosses });

  // The natural release span, then the single factor that stretches a short round to the
  // minimum (specs/matter.md). Once rounds are large the factor is 1 and has no effect.
  let natural = 0;
  for (const g of groups) natural += g.n * BURST_MS[g.type] + GROUP_GAP_MS;
  const stretch = natural > 0 && natural < MIN_SPAN_MS ? MIN_SPAN_MS / natural : 1;

  const events: SpawnEvent[] = [];
  let t = 600;
  let lane: Lane = 0;
  for (const g of groups) {
    const step = BURST_MS[g.type] * stretch;
    for (let i = 0; i < g.n; i++) {
      events.push({ atMs: Math.round(t), type: g.type, lane, electrons: g.electrons, inert: g.inert });
      // Rotate lanes WITHIN the group, so on a multi-path map every path receives the same
      // kind of matter at the same time (specs/board.md).
      lane = ((lane + 1) % lanes) as Lane;
      t += step;
    }
    t += GROUP_GAP_MS * stretch;
  }

  const durationMs = events.length ? events[events.length - 1]!.atMs + 1200 : 1200;

  // Distinct types, in a stable preview order.
  const order: MatterType[] = ["atom", "noble", "dimer", "polymer", "lattice", "heavy", "chelate", "shroud", "macromass"];
  const present = new Set(events.map((e) => e.type));
  const types = order.filter((t2) => present.has(t2));

  return { round: r, events, durationMs, types, hasBoss: bosses > 0 };
}
