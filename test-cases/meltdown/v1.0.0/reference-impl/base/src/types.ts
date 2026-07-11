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
  | "sink";

export const TOWER_ORDER: TowerType[] = [
  "arc",
  "stutter",
  "lance",
  "bloom",
  "rime",
  "flak",
  "forge",
  "sink",
];

export type SurgeType =
  | "mote"
  | "sprint"
  | "hulk"
  | "swarm"
  | "drift"
  | "core";

// The two entrances the surge spawns from (specs/playfield.md).
export type Vent = "left" | "top";

// A scheduled spawn within a wave.
export interface SpawnEvent {
  t: number; // seconds from wave start
  type: SurgeType;
  vent: Vent;
}
