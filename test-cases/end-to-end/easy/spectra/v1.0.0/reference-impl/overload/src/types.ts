// Spectra — shared types.

import type { Band } from "./constants";
import type { Path } from "./paths";

// The game's state machine (specs/gameplay.md).
export type GameState =
  | "title"
  | "howto"
  | "stageIntro"
  | "inWave"
  | "paused"
  | "stageCleared"
  | "gameOver";

export type DroneKind = "shard" | "flux" | "prism";

// A drone's movement phase (specs/drones.md).
export type DronePhase = "entering" | "formation" | "diving" | "returning";

// A live bullet. `band` is the band it was fired as, fixed for life. During a
// spectral inversion an enemy bullet's *effective* band is the opposite (see the
// Game); a player bullet is never inverted.
export interface Bullet {
  x: number;
  y: number;
  // Where this stood when the current step began, so the renderer can draw
  // between that and (x, y) — see Game.renderAlpha. Written by the step and read
  // by the renderer, never the other way about.
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  band: Band;
  friendly: boolean;
  dead: boolean;
}

// A drone. Prism-specific fields are only meaningful for kind === "prism".
export interface Drone {
  // A stable id, assigned when the drone is born, that appears in snapshot() and
  // that the debug API's spawnDrone/forceDive address (specs/instrumentation.md).
  id: number;
  kind: DroneKind;
  // A drone's stored band. For a Shard this is fixed; for a Flux it is the
  // currently held band (meaningless during a shimmer, see `shimmer`); for a
  // Prism this is the *shell* band while the shell is intact, else the core band.
  band: Band;
  x: number;
  y: number;
  // Where this stood when the current step began, so the renderer can draw
  // between that and (x, y) — see Game.renderAlpha. Written by the step and read
  // by the renderer, never the other way about.
  prevX: number;
  prevY: number;
  // Formation slot (grid column/row) and the slot's resting center.
  col: number;
  row: number;
  slotX: number;
  slotY: number;
  phase: DronePhase;
  angle: number; // facing, for a little visual flourish
  dead: boolean;

  // --- Path following (entering / diving / returning) ---
  path: Path | null;
  pathDist: number; // distance travelled along the current path
  // For a diving drone: scheduled firing distances still pending.
  fireAt: number[];
  // True while this drone is in a fast, straight headlong plunge — a Shard's
  // Overload reaction (specs/gameplay.md). Only meaningful in Overload mode.
  headlong: boolean;

  // --- Overload mode (specs/gameplay.md) ---
  // Mismatched-shot charge. A wrong-band shot adds 1; at OVERLOAD_CHARGE the drone
  // overloads (its per-type reaction) and this resets to 0. Always 0 in Sortie.
  charge: number;

  // --- Flux ---
  fluxBase: Band; // the band this Flux holds at the start of its cycle
  fluxClock: number; // seconds into the current oscillation cycle
  shimmer: boolean; // true during the 0.4s telegraph (no settled band)

  // --- Prism ---
  shellBand: Band;
  coreBand: Band;
  shellAlive: boolean;
  invertedThisDive: boolean; // already triggered an inversion on the current dive
}

// A drone-burst effect instance played through the particle runtime.
export interface Burst {
  x: number;
  y: number;
  size: number; // on-field footprint the 128x128 field is scaled to
}
