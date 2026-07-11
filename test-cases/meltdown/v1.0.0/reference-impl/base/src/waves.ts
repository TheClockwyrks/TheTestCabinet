// Meltdown — wave composition (specs/creeps.md, specs/flow.md). The exact spawn
// timing and per-wave mix are our design; the constraints are: early waves are
// mostly Motes and Sprints, Swarms and Hulks arrive as waves deepen, Drift
// flyers appear from the mid game, a Core boss anchors waves 10 and 20, and a
// wave mixes types so no single tower answers everything.

import type { SpawnEvent, SurgeType, Vent } from "./types";

interface Group {
  type: SurgeType;
  count: number;
  interval: number; // seconds between spawns
  delay: number; // seconds before the group starts
  vent: Vent | "split"; // "split" alternates between the two vents
}

// Waves are deliberately large and dense (specs/creeps.md): the player fields a
// dozen-plus cheap towers, so a thin or short maze must be overrun. Counts grow
// substantially across the 20 waves.
function buildGroups(w: number): Group[] {
  const g: Group[] = [];

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
  if (w === 10) {
    g.push({ type: "core", count: 1, interval: 4, delay: 7, vent: "left" });
  }
  if (w === 20) {
    g.push({ type: "core", count: 2, interval: 6, delay: 6, vent: "split" });
    g.push({ type: "hulk", count: 8, interval: 1.2, delay: 4, vent: "left" });
  }

  return g;
}

export function generateWave(w: number): SpawnEvent[] {
  const events: SpawnEvent[] = [];
  let splitToggle = w % 2 === 0; // vary the opening vent wave to wave
  for (const grp of buildGroups(w)) {
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

// A compact preview of the next wave's makeup for the build-panel banner.
export function wavePreview(w: number): Array<{ type: SurgeType; count: number }> {
  const counts = new Map<SurgeType, number>();
  for (const e of generateWave(w)) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const order: SurgeType[] = ["mote", "sprint", "swarm", "hulk", "drift", "core"];
  return order
    .filter((t) => counts.has(t))
    .map((t) => ({ type: t, count: counts.get(t)! }));
}
