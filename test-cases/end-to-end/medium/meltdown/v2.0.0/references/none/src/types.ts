// Meltdown — the vocabulary the whole build is written in.
//
// Nothing here has behavior: these are the names the specification uses, given
// as types so a misspelt screen, phase, tower, or vent is a compile error rather
// than a silent branch that never runs. The figures behind them are in
// `src/constants.ts` and `src/defs.ts`.

/** The eight screens the game is on exactly one of (specs/screens.md). */
export type Screen =
  | "title"
  | "modeselect"
  | "difficultyselect"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

/** The three sub-phases of the `playing` screen (specs/waves.md). */
export type Phase = "opening" | "building" | "wave";

/** The five modes (specs/modes.md). */
export type ModeId =
  "containment" | "hundred" | "deeppockets" | "bottleneck" | "suddendeath";

/** Containment's three difficulties (specs/modes.md). */
export type DifficultyId = "easy" | "medium" | "hard";

/** The eight towers, in shop order (specs/towers.md). */
export type TowerType =
  "arc" | "stutter" | "rime" | "flak" | "bloom" | "lance" | "forge" | "sink";

/** The six surge types (specs/surge.md). */
export type SurgeType = "mote" | "sprint" | "hulk" | "swarm" | "drift" | "core";

/** A footprint face, in either local or world orientation (specs/towers.md). */
export type Side = "N" | "E" | "S" | "W";

/** A placement rotation: each step is a further 90 degrees (specs/towers.md). */
export type Rotation = 0 | 1 | 2 | 3;

/** The two vents the surge enters through (specs/floor.md). */
export type Vent = "left" | "top";

/** The two exhausts the surge leaves through (specs/floor.md). */
export type Exhaust = "right" | "bottom";

/** The game-speed toggle (specs/waves.md). */
export type Speed = 1 | 2;

/** A tower's level (specs/towers.md). */
export type Level = 1 | 2 | 3;

/** The four faces, in the order rotation turns them: N -> E -> S -> W. */
export const SIDES: readonly Side[] = ["N", "E", "S", "W"];

/** A rectangle in logical stage units, as the panel reports its controls. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether `(x, y)` lies inside `rect`, its top and left edges included. */
export function inRect(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}
