// Meltdown — the figures a mode and a difficulty derive.
//
// specs/modes.md states that starting money, the wave count, the starting
// lives, whether interest is paid, whether there are build phases, and the
// build zone all follow the mode and difficulty and nothing else. That is why
// the debug surface carries no setter for any of them: they are computed here,
// from `state.mode` and `state.difficulty`, every time they are read.
//
// The Hundred overrides the wave progression rather than following it, so the
// composition helpers below take the mode as well as the wave number.

import {
  BOTTLENECK_ZONE,
  DIFFICULTY_TABLE,
  HUNDRED_HP_SCALE,
  HUNDRED_UNITS,
  MODE_TABLE,
  WAVE_CYCLE,
  hpScale,
  waveSize,
  waveType,
  type DifficultyName,
  type ModeName,
  type SurgeType,
} from "./constants";

/** The zone a mode restricts building to, or `null` for the whole floor. */
export type BuildZone = typeof BOTTLENECK_ZONE;

/** The money a run on this pair opens with. */
export function startMoneyOf(
  mode: ModeName,
  difficulty: DifficultyName,
): number {
  const row = MODE_TABLE[mode];
  return row.startMoney ?? DIFFICULTY_TABLE[difficulty].money;
}

/** The number of waves a run on this pair fights. */
export function waveCountOf(
  mode: ModeName,
  difficulty: DifficultyName,
): number {
  const row = MODE_TABLE[mode];
  return row.waveCount ?? DIFFICULTY_TABLE[difficulty].waves;
}

/** The lives a run on this mode opens with. */
export function startLivesOf(mode: ModeName): number {
  return MODE_TABLE[mode].startLives;
}

/** Whether this mode pays interest on entering a build phase. */
export function interestOf(mode: ModeName): boolean {
  return MODE_TABLE[mode].interest;
}

/** Whether this mode has build phases between waves at all. */
export function buildPhasesOf(mode: ModeName): boolean {
  return MODE_TABLE[mode].buildPhases;
}

/** The zone this mode restricts building to, or `null`. */
export function buildZoneOf(mode: ModeName): BuildZone | null {
  return MODE_TABLE[mode].buildZone;
}

/** Whether `(col, row)` lies inside a build zone. */
export function insideZone(zone: BuildZone, col: number, row: number): boolean {
  return (
    col >= zone.col0 && col <= zone.col1 && row >= zone.row0 && row <= zone.row1
  );
}

/**
 * The hp scaling a unit released on this wave carries. The Hundred applies its
 * own flat factor in place of the per-wave one (specs/modes.md, The Hundred).
 */
export function hpScaleOf(mode: ModeName, wave: number): number {
  return mode === "hundred" ? HUNDRED_HP_SCALE : hpScale(wave);
}

/**
 * The type of the `index`-th unit (counted from `0`) of wave `wave`. Every mode
 * but The Hundred fields one type per wave; The Hundred cycles `WAVE_CYCLE` one
 * unit at a time.
 */
export function unitTypeOf(
  mode: ModeName,
  wave: number,
  waveCount: number,
  index: number,
): SurgeType {
  if (mode === "hundred") return WAVE_CYCLE[index % WAVE_CYCLE.length];
  return waveType(wave, waveCount);
}

/** How many units wave `wave` releases on this mode. */
export function waveSizeOf(
  mode: ModeName,
  wave: number,
  waveCount: number,
): number {
  return mode === "hundred" ? HUNDRED_UNITS : waveSize(wave, waveCount);
}

/** The type the panel names for wave `wave`, which is its first unit's. */
export function waveTypeOf(
  mode: ModeName,
  wave: number,
  waveCount: number,
): SurgeType {
  return unitTypeOf(mode, wave, waveCount, 0);
}
