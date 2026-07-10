// Fathom — canonical constants.
//
// Every value here is in the fixed 1280x720 logical-pixel coordinate space
// defined by the specification (origin top-left, x right, y down). Rendering
// scales this space uniformly to the window; the simulation never leaves it.

export const STAGE_W = 1280;
export const STAGE_H = 720;

// ---- Tile grid (specs/overview.md) -------------------------------------
export const TILE = 32;
export const COLS = 36;
export const ROWS = 18;
export const GRID_X = 64; // top-left tile corner
export const GRID_Y = 80;
export const HUD_TOP = 80; // top strip y[0,80]
export const HUD_BOT_Y = 656; // bottom strip y[656,720]

// ---- Palette (matches reference/theme.css) -----------------------------
export const COLOR = {
  fog: "#03060c", // unrevealed fog / stage background
  water: "#0a1422", // revealed corridor floor
  rock: "#16293d", // revealed wall
  rim: "#24506b", // wall edge / rim light
  forager: "#46f0e0",
  plankton: "#b8f5c8",
  sonar: "#5ef2ff",
  lure: "#ffd166",
  listener: "#c46bff",
  flarefish: "#ff7a59",
  ink: "#0b0a1f",
  text: "#e6edf3",
  textDim: "#8a94a6",
  textFaint: "#4a5567",
  bgRaised: "#0a1018",
  panelBorder: "#16293d",
} as const;

// A system monospace stack: no downloaded web font, so the game renders
// identically offline.
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- The maze ----------------------------------------------------------
// A mirror-symmetric (about the vertical centerline between cols 17 and 18),
// one-tile-wide, fully-connected, dead-end-free braided maze with a solid
// border pierced only by the horizontal wrap tunnel on WRAP_ROW. Symbols:
//   '#' wall (solid rock)   '.' open corridor
//   'D' den interior (open, but the forager may not enter)
//   'G' the single den gate (passable only by predators)
// Authored with a symmetric carve+braid generator and validated for: border,
// mirror symmetry, no 2x2 open block, no dead ends, full connectivity, and the
// forager being able to reach every corridor tile (see the case notes).
export const MAZE: string[] = [
  "####################################",
  "#..................................#",
  "#.###.#.#######.####.#######.#.###.#",
  "#.....#.....#..........#.....#.....#",
  "#.#######.#.#.#.####.#.#.#.#######.#",
  "#.........#...#......#...#.........#",
  "###.#.#.#####.###G####.#####.#.#.###",
  "#...#.#.....#.##DDDD##.#.....#.#...#",
  "#.#.#.#####.#.##DDDD##.#.#####.#.#.#",
  "#.#.......#...##DDDD##...#.......#.#",
  "#.###.###.################.###.###.#",
  "#...#..........................#...#",
  "#.#.#.#####.############.#####.#.#.#",
  "..#.#.......#..........#.......#.#..",
  "#.#.###.#.###.#.####.#.###.#.###.#.#",
  "#.......#.....#......#.....#.......#",
  "####################################",
  "####################################",
];

export const WRAP_ROW = 13; // the horizontal wrap tunnel row (col 0 <-> col 35)
export const GATE_COL = 17; // the den gate column (gate tile at row 6)
export const GATE_ROW = 6;
// Den interior bounds (inclusive), for predator den logic / plankton exclusion.
export const DEN_C0 = 16;
export const DEN_C1 = 19;
export const DEN_R0 = 7;
export const DEN_R1 = 9;
// The forager's fixed spawn tile (lower half, on/near the centerline).
export const START_COL = 17;
export const START_ROW = 15;

// ---- Timing ------------------------------------------------------------
export const FIXED_STEP = 1 / 120; // physics timestep (Hz)

// ---- Movement (specs/movement.md) --------------------------------------
export const FORAGER_SPEED = 128; // px/s (4 tiles/s)

// ---- Brightness (specs/sensing.md) -------------------------------------
export const BRIGHT_PER_EAT = 0.34;
export const BRIGHT_HALFLIFE = 0.9; // G *= 0.5^(dt/0.9)
export const VISION_MIN = 96; // px at rest (3 tiles)
export const VISION_GAIN = 64; // V = 96 + 64*G  -> up to 160

// ---- Sonar (specs/sensing.md) ------------------------------------------
export const SONAR_COOLDOWN = 3.5; // s
export const SONAR_RANGE_BASE = 9; // corridor tiles (E), shrinks with depth
export const SONAR_MARK_TIME = 1.5; // s predators stay marked after a pulse
export const SONAR_RING_TIME = 0.7; // s visible travel of the drawn ring

// ---- Ink (specs/movement.md) -------------------------------------------
export const INK_COOLDOWN = 8; // s
export const INK_RADIUS = 80; // px (2.5 tiles)
export const INK_LIFE = 3; // s

// ---- Predators (specs/predators.md) ------------------------------------
export const RELEASE_LURE = 0; // s after (re)start
export const RELEASE_LISTENER = 5;
export const RELEASE_FLAREFISH = 10;

export const LURE_SPEED = 116;
export const LURE_RANGE_BASE = 128; // R = 128 + 192*G
export const LURE_RANGE_GAIN = 192;
export const LURE_TELL_RANGE = 96; // ~3 tiles, LOS, the faint lure-light
export const LURE_LINGER = 2; // s

export const LISTENER_PATROL_SPEED = 120;
export const LISTENER_TOP_SPEED = 184;
export const LISTENER_ACCEL = 50; // px/s^2 while hunting
export const LISTENER_TURN_CAP = 130; // can only corner at or below this speed
export const LISTENER_HEAR_RANGE = 64; // ~2 tiles, in or out of LOS
export const LISTENER_PULSE_INTERVAL = 3; // s, its own tell
export const LISTENER_HUNT_TIME = 5; // s after a pulse (refreshed by each)

export const FLAREFISH_SPEED = 116;
export const FLARE_INTERVAL = 7; // s between flares
export const FLARE_CHARGE = 0.5; // s telegraph
export const FLARE_BLOOM = 1; // s bloom
export const FLARE_FADE = 0.5; // s fade-out
export const FLARE_RADIUS = 192; // px (6 tiles)
export const FLARE_HUNT_TIME = 4; // s fix after being caught in a bloom

// ---- Depth scaling (specs/flow.md) -------------------------------------
export function predatorSpeedMult(depth: number): number {
  return Math.min(1.4, 1 + 0.08 * (depth - 1));
}
export function sonarRange(depth: number): number {
  return Math.max(5, SONAR_RANGE_BASE - (depth - 1));
}

// ---- Scoring (specs/flow.md) -------------------------------------------
export const SCORE_PLANKTON = 10;
export const SCORE_DRIFTER = 200;
export const SCORE_CLEAR = 500;
export const START_LIVES = 3;

// ---- Bonus drifter (specs/playfield.md) --------------------------------
export const DRIFTER_INTERVAL = 25; // s cadence while plankton remain
export const DRIFTER_SPEED = 64; // px/s (half the forager)
export const DRIFTER_LIFE = 12; // s before it leaves

// ---- Dive countdown ----------------------------------------------------
export const DIVE_COUNT = 3; // "DIVE" 3..2..1
export const DIVE_STEP = 0.7; // s per number
