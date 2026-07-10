// Meltdown — shared types.

export type AppState =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

// During "playing" the match is in one of two phases (specs/flow.md).
export type Phase = "build" | "wave";

// The eight tower types, in shop order (specs/playfield.md, hotkeys 1..8).
export type TowerType =
  | "arc"
  | "stutter"
  | "lance"
  | "bloom"
  | "rime"
  | "flak"
  | "forge"
  | "vent";

export const TOWER_ORDER: TowerType[] = [
  "arc",
  "stutter",
  "lance",
  "bloom",
  "rime",
  "flak",
  "forge",
  "vent",
];

export type SurgeType =
  | "mote"
  | "sprint"
  | "hulk"
  | "swarm"
  | "drift"
  | "core";

export type Intake = "left" | "top";

// A scheduled spawn within a wave.
export interface SpawnEvent {
  t: number; // seconds from wave start
  type: SurgeType;
  intake: Intake;
}
