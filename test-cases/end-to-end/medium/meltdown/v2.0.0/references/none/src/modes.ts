// Meltdown — what a mode and a difficulty derive (specs/modes.md).
//
// Every figure here follows the chosen mode and difficulty and nothing else, so
// none of it is stored: the snapshot reports these as derived reads and the run
// carries only its live money, lives, score and wave. A mode changes only the
// figures its own row states, which is why this file is one table and no logic.

import {
  BOTTLENECK_MONEY,
  BOTTLENECK_ZONE,
  DEEP_POCKETS_MONEY,
  DIFFICULTY_TABLE,
  HUNDRED_MONEY,
  START_LIVES,
  SUDDEN_DEATH_LIVES,
  SUDDEN_DEATH_MONEY,
} from "./constants";
import type { DifficultyId, ModeId } from "./types";

/** The rectangle of tiles a mode restricts building to, both ends included. */
export interface BuildZone {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
}

/** Everything a mode and difficulty fix, and nothing they do not. */
export interface ModeFigures {
  startMoney: number;
  waveCount: number;
  startLives: number;
  /** Whether entering a build phase between waves pays interest. */
  interest: boolean;
  /** Whether the run has build phases between waves at all. */
  buildPhases: boolean;
  /** The zone building is restricted to, or `null` for the whole floor. */
  buildZone: BuildZone | null;
}

/** The figures `mode` and `difficulty` derive (specs/modes.md). */
export function modeFigures(
  mode: ModeId,
  difficulty: DifficultyId,
): ModeFigures {
  const row = DIFFICULTY_TABLE[difficulty];
  switch (mode) {
    case "containment":
      return {
        startMoney: row.money,
        waveCount: row.waves,
        startLives: START_LIVES,
        interest: true,
        buildPhases: true,
        buildZone: null,
      };
    case "hundred":
      return {
        startMoney: HUNDRED_MONEY,
        waveCount: 1,
        startLives: START_LIVES,
        interest: false,
        buildPhases: false,
        buildZone: null,
      };
    case "deeppockets":
      return {
        startMoney: DEEP_POCKETS_MONEY,
        waveCount: 20,
        startLives: START_LIVES,
        interest: false,
        buildPhases: true,
        buildZone: null,
      };
    case "bottleneck":
      return {
        startMoney: BOTTLENECK_MONEY,
        waveCount: 20,
        startLives: START_LIVES,
        interest: true,
        buildPhases: true,
        buildZone: { ...BOTTLENECK_ZONE },
      };
    case "suddendeath":
      return {
        startMoney: SUDDEN_DEATH_MONEY,
        waveCount: 20,
        startLives: SUDDEN_DEATH_LIVES,
        interest: true,
        buildPhases: true,
        buildZone: null,
      };
  }
}

/** What the mode-select screen says each mode changes, before it is chosen. */
export const MODE_BLURBS: Record<ModeId, string> = {
  containment:
    "The standard run. Hold the floor through every wave of the progression, at one of three difficulties.",
  hundred:
    "One onslaught of a hundred units, cycling every type, each at six times its base hp. No build phases.",
  deeppockets:
    "Ten thousand money to open on, and no interest. The standard twenty-wave progression otherwise.",
  bottleneck:
    "Building is restricted to a marked central zone. The surge still walks the whole floor.",
  suddendeath:
    "One life. A single leak of anything ends the run. The standard twenty-wave progression otherwise.",
};
