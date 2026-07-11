// Floe — shared types.

// Top-level game states (specs/flow.md, Game states).
export type AppState =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

// Sub-phase within the live game.
export type Phase = "crossing" | "dying" | "clearing";

// A cardinal hop direction.
export type Dir = "up" | "down" | "left" | "right";

export const DIR_VEC: Record<Dir, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

// A sliding ice-band vehicle.
export type VehicleKind = "plow" | "dogsled" | "car";

// A drifting water-band floe.
export type FloeKind = "pan" | "raft3" | "raft4";

export interface Item {
  // Strait-local left-edge x (px) of the sprite.
  x: number;
  // Length in tiles (plow 3, dogsled/car/raft vary, pan 1).
  len: number;
}

export interface Vehicle extends Item {
  kind: VehicleKind;
}

export interface Floe extends Item {
  kind: FloeKind;
}

// A lane of sliding items in a single strait row.
export interface Lane<T extends Item> {
  row: number;
  dir: 1 | -1; // +1 slides right, -1 slides left
  speed: number; // tiles per second (positive magnitude)
  trackLen: number; // wrap period in px
  items: T[];
}
