// Meltdown — the wave progression, as closed forms (specs/waves.md).
//
// A wave's type and its size are functions of the wave number and the run's wave
// count, so nothing about a run's composition is stored or drawn: the only
// randomness in the game is the vent each unit enters at.
// The Hundred replaces the progression outright, and `specs/modes.md` states that
// override, so it lives here beside the rule it overrides.

import {
  HUNDRED_HP_SCALE,
  HUNDRED_UNITS,
  WAVE_BASE_COUNT,
  WAVE_CYCLE,
  WAVE_GROWTH,
  WAVE_OPENING,
  hpScale,
} from "./constants";
import type { ModeId, SurgeType } from "./types";

/** The two waves of an `n`-wave run that field the Core (specs/waves.md). */
export function milestoneWaves(n: number): [number, number] {
  return [Math.round(n / 2), n];
}

/** Whether wave `w` of an `n`-wave run is one of the two milestones. */
export function isMilestone(w: number, n: number): boolean {
  const [mid, last] = milestoneWaves(n);
  return w === mid || w === last;
}

/** The single type wave `w` of an `n`-wave run fields. */
export function waveType(w: number, n: number): SurgeType {
  if (isMilestone(w, n)) return "core";
  if (w <= WAVE_OPENING.length) return WAVE_OPENING[w - 1];
  return WAVE_CYCLE[(w - (WAVE_OPENING.length + 1)) % WAVE_CYCLE.length];
}

/** How many units wave `w` of an `n`-wave run releases. */
export function waveSize(w: number, n: number): number {
  const type = waveType(w, n);
  if (type === "core") return 1;
  return Math.ceil(WAVE_BASE_COUNT[type] * (1 + WAVE_GROWTH * (w - 1)));
}

/**
 * The type of the `index`-th unit (counted from `0`) of The Hundred's onslaught.
 *
 * The one wave in the game that fields more than one type: it cycles
 * `WAVE_CYCLE` a unit at a time, so the first unit is a Mote, the second a
 * Sprint, and so on to the hundredth (specs/modes.md).
 */
export function hundredTypeAt(index: number): SurgeType {
  return WAVE_CYCLE[index % WAVE_CYCLE.length];
}

/** How many units the wave the run is on releases, mode override included. */
export function releaseCount(mode: ModeId, w: number, n: number): number {
  return mode === "hundred" ? HUNDRED_UNITS : waveSize(w, n);
}

/**
 * The type the `index`-th unit of the current wave carries, counted from `0`.
 *
 * Every mode but The Hundred fields one type for the whole wave, so the index is
 * read only there.
 */
export function releaseTypeAt(
  mode: ModeId,
  w: number,
  n: number,
  index: number,
): SurgeType {
  return mode === "hundred" ? hundredTypeAt(index) : waveType(w, n);
}

/**
 * The factor a unit's base hp is multiplied by on the wave the run is on.
 *
 * The Hundred carries one flat factor wherever in the onslaught a unit arrives,
 * in place of the per-wave scaling (specs/modes.md).
 */
export function releaseHpScale(mode: ModeId, w: number): number {
  return mode === "hundred" ? HUNDRED_HP_SCALE : hpScale(w);
}

/** What the panel's next-wave preview draws for a coming wave. */
export interface WavePreview {
  type: SurgeType;
  count: number;
}

/**
 * The type and count of the wave `w` of an `n`-wave run, as the preview reads
 * it. The Hundred's onslaught opens on a Mote and runs a hundred units.
 */
export function wavePreview(
  mode: ModeId,
  w: number,
  n: number,
): WavePreview | null {
  if (w < 1 || w > n) return null;
  if (mode === "hundred") {
    return { type: hundredTypeAt(0), count: HUNDRED_UNITS };
  }
  return { type: waveType(w, n), count: waveSize(w, n) };
}
