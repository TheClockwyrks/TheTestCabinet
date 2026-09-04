// Meltdown — the run's progression, as closed forms.
//
// What a mode and a difficulty fix (specs/modes.md), and what a wave number
// turns into (specs/waves.md), are both pure functions of the declared state,
// so nothing here is stored: `waveCount`, `startMoney`, `startLives`,
// `interest` and `buildZone` follow the mode and difficulty and the debug
// surface has no setter for any of them.
//
// The Hundred overrides the progression rather than following it: one wave of
// exactly `HUNDRED_UNITS` cycling `WAVE_CYCLE` one unit at a time, which is the
// one wave in the game that fields more than one type.

import {
  BOTTLENECK_ZONE,
  DIFFICULTY_TABLE,
  HUNDRED_UNITS,
  MODE_TABLE,
  WAVE_CYCLE,
  waveSize,
  waveType,
  type SurgeType,
} from "./constants";
import type { MeltdownState } from "./game";

/** Everything the mode and the difficulty decide, and nothing else. */
export interface Figures {
  waveCount: number;
  startMoney: number;
  startLives: number;
  interest: boolean;
  buildPhases: boolean;
  buildZone: typeof BOTTLENECK_ZONE | null;
}

/** The derived figures for the mode and difficulty the run is being played on. */
export function figuresOf(state: MeltdownState): Figures {
  const row = MODE_TABLE[state.mode];
  const difficulty = DIFFICULTY_TABLE[state.difficulty];
  return {
    waveCount: row.waveCount ?? difficulty.waves,
    startMoney: row.startMoney ?? difficulty.money,
    startLives: row.startLives,
    interest: row.interest,
    buildPhases: row.buildPhases,
    buildZone: row.buildZone,
  };
}

/** The single type wave `w` carries, and the first of The Hundred's cycle. */
export function waveTypeFor(state: MeltdownState, w: number): SurgeType {
  if (state.mode === "hundred") return WAVE_CYCLE[0];
  return waveType(w, figuresOf(state).waveCount);
}

/** How many units wave `w` releases. */
export function waveSizeFor(state: MeltdownState, w: number): number {
  if (state.mode === "hundred") return HUNDRED_UNITS;
  return waveSize(w, figuresOf(state).waveCount);
}

/**
 * The type of the unit the spawner releases next.
 *
 * A Containment wave fields one type throughout; The Hundred cycles
 * `WAVE_CYCLE` one unit at a time, indexed by how many of the hundred have
 * already gone (specs/modes.md, The Hundred).
 */
export function releaseTypeFor(state: MeltdownState): SurgeType {
  if (state.mode !== "hundred") return waveTypeFor(state, state.wave);
  const released = HUNDRED_UNITS - state.wavePending;
  const index =
    ((released % WAVE_CYCLE.length) + WAVE_CYCLE.length) % WAVE_CYCLE.length;
  return WAVE_CYCLE[index];
}

/**
 * The coming wave's type and count: the wave a build or opening phase is
 * preparing for, the one after the wave being fought, and `null` once the run
 * has no wave left to field.
 */
export function nextWaveInfo(
  state: MeltdownState,
): { type: SurgeType; count: number } | null {
  const { waveCount } = figuresOf(state);
  const coming = state.phase === "wave" ? state.wave + 1 : state.wave;
  if (coming > waveCount) return null;
  return {
    type: waveTypeFor(state, coming),
    count: waveSizeFor(state, coming),
  };
}
