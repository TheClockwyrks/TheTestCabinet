// Shared world types. Kept free of behavior so the subsystems (worm, foes, field,
// render) can all depend on them without import cycles.

export type GameState =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

// Sub-phase while `state === "playing"`.
export type PlayPhase = "banner" | "active" | "respawn";

export interface Tile {
  c: number;
  r: number;
}

// A single data-worm: a chain of tiles, head first.
export interface Worm {
  segs: Tile[]; // segs[0] is the head, segs[last] is the tail
  dh: number; // horizontal heading: +1 right, -1 left
  dv: number; // vertical heading: +1 down, -1 up
  diving: boolean; // riding straight down a critical column
  facing: number; // last horizontal facing, for mirrored rendering (+1/-1)
}

export type FoeKind = "glitch" | "dropper" | "corruptor";

export interface Foe {
  kind: FoeKind;
  x: number; // logical-pixel center
  y: number;
  // Where this stood when the current step began, so the renderer can draw
  // between that and (x, y) — see Game.renderAlpha. Written by the step and read
  // by the renderer, never the other way about.
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  // glitch: countdown to the next sideways dart.
  turnTimer: number;
  // dropper: whether it has taken its first (non-lethal, speed-up) hit; and the
  // last row it dropped a node into (to seed each row it passes at most once).
  hitOnce: boolean;
  lastDropRow: number;
  // corruptor: the row it crawls across; and last column it slammed.
  row: number;
  lastSlamCol: number;
}

export interface Bolt {
  x: number;
  y: number;
  // Where this stood when the current step began, so the renderer can draw
  // between that and (x, y) — see Game.renderAlpha. Written by the step and read
  // by the renderer, never the other way about.
  prevX: number;
  prevY: number;
}

// A single lightning segment of a discharge, fading out over its life.
export interface Arc {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number; // seconds remaining
  max: number;
}

export interface Flash {
  x: number;
  y: number;
  life: number;
  max: number;
}
