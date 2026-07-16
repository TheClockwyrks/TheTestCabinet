// Meltdown — wave composition (specs/creeps.md, specs/flow.md). The exact spawn
// timing and per-wave mix are our design; the constraints are: early waves are
// mostly Motes and Sprints, Swarms and Hulks arrive as waves deepen, Drift
// flyers appear from the mid game, a Core boss anchors the milestone waves, and a
// wave mixes types so no single tower answers everything. The number of waves
// varies with the selected mode/difficulty (specs/modes.md), so the milestone
// (Core-boss) waves are derived from the run's total rather than hard-coded.

import type { SpawnEvent, SurgeType, Vent } from "./types";

interface Group {
  type: SurgeType;
  count: number;
  interval: number; // seconds between spawns
  delay: number; // seconds before the group starts
  vent: Vent | "split"; // "split" alternates between the two vents
}

// The Core-boss milestone waves for a run of `totalWaves`: always the final wave,
// plus a mid-run wave once the run is long enough to have a distinct middle.
export function midBossWave(totalWaves: number): number {
  return totalWaves >= 6 ? Math.round(totalWaves / 2) : -1;
}
export function isBossWave(w: number, totalWaves: number): boolean {
  return w === totalWaves || w === midBossWave(totalWaves);
}

// Waves are deliberately large and dense (specs/creeps.md): the player fields a
// dozen-plus cheap towers, so a thin or short maze must be overrun. Counts grow
// substantially across the run.
function buildGroups(w: number, totalWaves: number): Group[] {
  const g: Group[] = [];
  const mid = midBossWave(totalWaves);
  const isFinal = w === totalWaves;

  // Motes — the backbone of every wave, growing steadily. The early waves stay
  // light so the opening maze can be established; volume climbs into the late
  // game where a short or cold defence is overrun.
  g.push({ type: "mote", count: 6 + Math.floor(w * 2.0), interval: 0.5, delay: 0, vent: "split" });

  // Sprints from wave 2 — fast and fragile, pressing the maze length.
  if (w >= 2) {
    g.push({ type: "sprint", count: 3 + Math.floor(w * 1.4), interval: 0.36, delay: 2.5, vent: "top" });
  }

  // Swarm packs from wave 5 — dense clusters that flood a chokepoint and are the
  // clearest test of splash and of a kill-box's heat. They start modest and grow.
  if (w >= 5) {
    g.push({ type: "swarm", count: 8 + Math.floor((w - 4) * 2.4), interval: 0.12, delay: 4.5, vent: "left" });
  }

  // Hulks from wave 6 — slow walls of HP that want concentrated, white-hot fire.
  if (w >= 6) {
    g.push({ type: "hulk", count: 1 + Math.floor((w - 5) / 2), interval: 1.6, delay: 5.5, vent: "top" });
  }

  // Drift flyers from wave 7 — they ignore the maze and demand air coverage.
  if (w >= 7) {
    g.push({ type: "drift", count: 2 + Math.floor(w * 0.6), interval: 0.9, delay: 3.5, vent: "split" });
  }

  // A second Swarm burst from the late game to redline the kill-boxes.
  if (w >= 13) {
    g.push({ type: "swarm", count: 14 + Math.floor(w * 1.4), interval: 0.09, delay: 9, vent: "top" });
  }

  // Core boss on the milestone waves, with an escort on the finale.
  if (w === mid && !isFinal) {
    g.push({ type: "core", count: 1, interval: 4, delay: 7, vent: "left" });
  }
  if (isFinal) {
    g.push({ type: "core", count: 2, interval: 6, delay: 6, vent: "split" });
    g.push({ type: "hulk", count: 8, interval: 1.2, delay: 4, vent: "left" });
  }

  return g;
}

function flatten(groups: Group[], splitStart: boolean): SpawnEvent[] {
  const events: SpawnEvent[] = [];
  let splitToggle = splitStart;
  for (const grp of groups) {
    for (let k = 0; k < grp.count; k++) {
      let vent: Vent;
      if (grp.vent === "split") {
        vent = splitToggle ? "left" : "top";
        splitToggle = !splitToggle;
      } else {
        vent = grp.vent;
      }
      events.push({ t: grp.delay + k * grp.interval, type: grp.type, vent });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

export function generateWave(w: number, totalWaves: number): SpawnEvent[] {
  return flatten(buildGroups(w, totalWaves), w % 2 === 0);
}

// The Hundred (specs/modes.md): one continuous, escalating surge of exactly one
// hundred units — no build phases, no per-wave HP ramp (the mode's flat hpMult
// carries the difficulty). The groups below sum to exactly 100 units.
function onslaughtGroups(): Group[] {
  return [
    { type: "mote", count: 24, interval: 0.55, delay: 0, vent: "split" },
    { type: "sprint", count: 18, interval: 0.4, delay: 6, vent: "top" },
    { type: "swarm", count: 24, interval: 0.14, delay: 14, vent: "left" },
    { type: "hulk", count: 12, interval: 1.4, delay: 20, vent: "top" },
    { type: "drift", count: 12, interval: 0.8, delay: 26, vent: "split" },
    { type: "mote", count: 8, interval: 0.4, delay: 34, vent: "split" },
    { type: "core", count: 2, interval: 7, delay: 40, vent: "split" },
  ];
}

export function generateOnslaught(): SpawnEvent[] {
  return flatten(onslaughtGroups(), true);
}

// A compact preview of a wave's makeup for the build-panel banner.
export function wavePreview(w: number, totalWaves: number): Array<{ type: SurgeType; count: number }> {
  return summarise(generateWave(w, totalWaves));
}
export function onslaughtPreview(): Array<{ type: SurgeType; count: number }> {
  return summarise(generateOnslaught());
}

function summarise(events: SpawnEvent[]): Array<{ type: SurgeType; count: number }> {
  const counts = new Map<SurgeType, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const order: SurgeType[] = ["mote", "sprint", "swarm", "hulk", "drift", "core"];
  return order.filter((t) => counts.has(t)).map((t) => ({ type: t, count: counts.get(t)! }));
}
