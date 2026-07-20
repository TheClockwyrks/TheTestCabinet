// Meltdown — wave composition (specs/surge.md, specs/waves.md). Each wave releases
// a SINGLE intruder type, so every wave stresses one specific answer rather than a
// mixture the player meets all at once: a Mote wave is raw sustained volume, a
// Sprint wave a fast rush, a Swarm wave a splash-hungry flood, a Hulk wave a slow
// column of armor, a Drift wave a flight over the maze. The type each wave carries
// follows a fixed progression that introduces the roster over the opening waves and
// then cycles it; the milestone waves are the Core boss. The exact per-type counts,
// spawn timing, and vent split are our design. The number of waves varies with the
// selected mode/difficulty (specs/modes.md), so the milestone (Core-boss) waves are
// derived from the run's total rather than hard-coded.

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

// The single type a wave carries. The opening waves introduce the roster in an
// order that lets a defence grow into each threat — Motes to teach the maze and the
// heat curve, then Sprints, Swarms, Drifts, and finally Hulks — after which the five
// types cycle so each recurs and the between-wave game is always re-shaping the floor
// for the next one. Milestone waves override to the Core boss.
const INTRO: SurgeType[] = ["mote", "mote", "sprint", "swarm", "drift", "mote", "sprint", "hulk"];
const CYCLE: SurgeType[] = ["swarm", "drift", "mote", "sprint", "hulk"];

export function waveType(w: number, totalWaves: number): SurgeType {
  if (isBossWave(w, totalWaves)) return "core";
  // Index by the number of non-boss waves before this one, so a milestone wave never
  // consumes a slot in the rotation: the introduction always runs to completion and
  // every type keeps recurring, wherever the Core waves happen to fall in a run.
  let i = 0;
  for (let k = 1; k < w; k++) if (!isBossWave(k, totalWaves)) i += 1;
  return i < INTRO.length ? INTRO[i] : CYCLE[(i - INTRO.length) % CYCLE.length];
}

// A wave is one group of its type (specs/surge.md), sized for that type's threat and
// growing across the run (HP also scales per wave, specs/waves.md): the volume types
// field enough units that a thin or short maze is overrun, while the Hulk column is a
// handful of very tanky units. Counts grow with the wave number `w`.
function buildGroups(w: number, totalWaves: number): Group[] {
  const type = waveType(w, totalWaves);
  const isFinal = w === totalWaves;

  switch (type) {
    case "core": {
      // A pure Core wave anchors each milestone; the finale fields more Cores than
      // the midpoint, climbing with the run's length.
      const count = isFinal ? Math.max(2, Math.round(totalWaves / 9)) : 1;
      return [{ type: "core", count, interval: 6, delay: 4, vent: "split" }];
    }
    case "mote":
      // Large sustained volume — the maze must keep enough guns fed to grind it down.
      return [{ type: "mote", count: 8 + Math.round(w * 5.0), interval: 0.27, delay: 0, vent: "split" }];
    case "sprint":
      // A fast rush — punishes a short maze; slowing (Rime) or a long kill-box holds it.
      return [{ type: "sprint", count: 4 + Math.round(w * 3.0), interval: 0.22, delay: 0, vent: "split" }];
    case "swarm":
      // A dense flood, concentrated at one vent (alternating across the run) so it
      // packs a single kill-box — the clearest test of splash (Bloom) and the surest
      // way to run a boxed core to its redline.
      return [{ type: "swarm", count: 10 + Math.round(w * 7.0), interval: 0.09, delay: 0, vent: w % 2 === 0 ? "top" : "left" }];
    case "hulk":
      // A slow column of armor — few units, huge HP, wanting concentrated white-hot fire.
      return [{ type: "hulk", count: 2 + Math.round(w * 0.5), interval: 1.3, delay: 0, vent: "split" }];
    case "drift":
      // A flight of flyers over the maze — dedicated anti-air (Flak) or they leak.
      return [{ type: "drift", count: 4 + Math.round(w * 1.9), interval: 0.5, delay: 0, vent: "split" }];
  }
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
