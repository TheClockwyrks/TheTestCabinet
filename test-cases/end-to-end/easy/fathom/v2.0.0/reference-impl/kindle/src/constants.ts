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

// ---- Palette (matches specs/overview.md) -------------------------------
export const COLOR = {
  fog: "#03060c", // unrevealed fog / stage background
  water: "#0a1422", // revealed corridor floor
  rock: "#16293d", // revealed wall
  rim: "#24506b", // wall edge / rim light
  forager: "#46f0e0",
  plankton: "#b8f5c8",
  sonar: "#5ef2ff",
  lanternjaw: "#ffd166", // the Lanternjaw and its bulb; also the bonus drifter
  gloamfin: "#c46bff",
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
export const BRIGHT_HOLD = 1.0; // s G holds after the last pellet before decay; resets on each eat
export const BRIGHT_HALFLIFE = 0.9; // G *= 0.5^(dt/0.9) once decay begins
export const VISION_MIN = 96; // px at rest (3 tiles)
export const VISION_GAIN = 64; // V = 96 + 64*G  -> up to 160

// Kindle only — the outer **vision circle**: a render mask (NOT a reveal). The
// already-revealed trench (terrain, pellets) is drawn only within this radius of
// the forager; beyond it is pitch black. It grows as you eat (specs/sensing.md).
export const KINDLE_VISION_MIN = 192; // px (6 tiles) at rest
export const KINDLE_VISION_GAIN = 128; // R = 192 + 128*G  -> up to 320 (10 tiles)

// ---- Sonar (specs/sensing.md) ------------------------------------------
export const SONAR_COOLDOWN = 1.5; // s (short: sonar's real cost is attracting the Gloamfin, not the cooldown)
export const SONAR_RANGE_BASE = 9; // corridor tiles (E), shrinks with depth
export const SONAR_MARK_TIME = 1.5; // s predators stay marked after a pulse
// The ping is a wavefront that travels OUTWARD through the corridors — bending
// around bends and reflecting off walls (it follows the corridor flood, not a
// circle), so it reveals near tiles first and far tiles later, and its true
// reach is legible instead of a misleading disc (specs/sensing.md).
export const SONAR_WAVE_SPEED = 14; // corridor tiles/sec the wavefront advances
export const SONAR_WAVE_BAND = 2.6; // tiles: width of the glowing wavefront band
export const SONAR_CYAN_RGB = "94,242,255"; // COLOR.sonar (#5ef2ff), the forager's ping
export const SONAR_VIOLET_RGB = "196,107,255"; // COLOR.gloamfin (#c46bff), the Gloamfin's ping
export const SONAR_ORANGE_RGB = "255,150,60"; // the guaranteed "lost you" ping, distinct from the violet (specs/predators.md)

// ---- Ink (specs/movement.md) -------------------------------------------
export const INK_COOLDOWN = 8; // s
export const INK_RADIUS = 80; // px (2.5 tiles)
export const INK_LIFE = 3; // s

// ---- Predators (specs/predators.md) ------------------------------------
export const RELEASE_LANTERNJAW = 0; // s after (re)start
export const RELEASE_GLOAMFIN = 5;
export const RELEASE_FLAREFISH = 10;

// Ordinary predator speed — the Lanternjaw, the Gloamfin at wander, and the
// Flarefish all share it (specs/predators.md).
export const PREDATOR_SPEED = 116;

// The Lanternjaw — hunts your light.
export const LANTERNJAW_SPEED = PREDATOR_SPEED;
export const LANTERNJAW_RANGE_BASE = 128; // R = 128 + 192*G
export const LANTERNJAW_RANGE_GAIN = 192;
export const LANTERNJAW_LINGER = 2; // s

// The Gloamfin — hunts your sound. Wanders at the ordinary speed (no wind-up),
// then chases just a touch faster than the forager to where a ping caught you.
export const GLOAMFIN_PATROL_SPEED = PREDATOR_SPEED;
export const GLOAMFIN_CHASE_SPEED = 134; // cap: only ~5% faster than the forager's 128
// Rounding a corner in a chase costs the Gloamfin speed: it drops to CORNER_SPEED
// (~10% BELOW the forager) the moment it turns, then ramps back to the cap at
// CHASE_RECOVER px/s each second — so a player who keeps cornering can gain ground
// and slip away instead of being reeled in on a straight line (specs/predators.md).
export const GLOAMFIN_CORNER_SPEED = 115; // px/s (~10% below the forager's 128)
export const GLOAMFIN_CHASE_RECOVER = 10; // px/s regained per second after a corner (~1.9 s back to the cap)
export const GLOAMFIN_HEAR_RANGE = 64; // ~2 tiles, in or out of LOS
export const GLOAMFIN_PING_INTERVAL = 4; // s, its own periodic ping (tell + sense)
export const GLOAMFIN_PING_RANGE = 9; // corridor tiles its ping floods
export const GLOAMFIN_PING_MIN_GAP = 3; // s minimum between ANY two of its pings, so it cannot rapid-fire up close
export const GLOAMFIN_SEARCH_PING_DELAY = 1.2; // s at an empty fix before the guaranteed "lost you" ping
export const GLOAMFIN_SEARCH_TIME = 5; // s casting about an empty fix before giving up

// The Flarefish — gives off no tell but its flare (revealed by your light/sonar
// like the others), then chases like the Lanternjaw once its flare catches you.
export const FLAREFISH_SPEED = PREDATOR_SPEED;
export const FLARE_INTERVAL = 7; // s between flares while wandering
export const FLARE_REARM = 7; // s before the first flare after losing you
export const FLARE_CHARGE = 0.5; // s telegraph
export const FLARE_BLOOM = 1; // s bloom
export const FLARE_FADE = 0.5; // s fade-out
export const FLARE_RADIUS = 192; // px (6 tiles), ignores walls
export const FLARE_LINGER = 2; // s chase linger after losing you (like the Lanternjaw)

// The detection alert flash (specs/predators.md), fired when the Gloamfin's ping
// or the Flarefish's flare acquires you.
export const DETECT_FLASH_TIME = 0.5; // s

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
export const DRIFTER_INTERVAL = 25; // s between spawns, while under the cap and plankton remain
export const DRIFTER_SPEED = 64; // px/s (half the forager)
export const MAX_DRIFTERS = 2; // at most this many drifters exist at once; each is permanent until eaten

// ---- Dive countdown ----------------------------------------------------
export const DIVE_COUNT = 3; // "DIVE" 3..2..1
export const DIVE_STEP = 0.7; // s per number
