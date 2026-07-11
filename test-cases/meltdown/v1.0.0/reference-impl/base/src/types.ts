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

// The four footprint faces, in world orientation. A tower's radiator faces are
// stored in local (rot = 0) space and mapped to world space by its rotation.
export type Side = "N" | "E" | "S" | "W";
export const SIDES: Side[] = ["N", "E", "S", "W"];

// A tower's rotation: number of 90-degree clockwise turns (0..3). Rotating maps
// local face N -> E -> S -> W (specs/heat.md, specs/towers.md).
export type Rotation = 0 | 1 | 2 | 3;

// Rotate a local face into world space by `rot` clockwise quarter-turns.
export function rotateSide(side: Side, rot: Rotation): Side {
  const i = SIDES.indexOf(side);
  return SIDES[(i + rot) % 4];
}

// The two entrances the surge spawns from (specs/playfield.md).
export type Vent = "left" | "top";

// A scheduled spawn within a wave.
export interface SpawnEvent {
  t: number; // seconds from wave start
  type: SurgeType;
  vent: Vent;
}
