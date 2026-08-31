// Facet — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every position and distance is in the fixed 1280x720 logical coordinate space
// defined by `specs/overview.md` (origin top-left, x right, y down). That space
// is the engine's logical design size: the engine scales and letterboxes it
// onto the canvas, so no value here is ever expressed in real pixels and
// gameplay never leaves logical space. The pointer position the game reads is
// in these same units, so a hit test against a cell center needs no
// conversion.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Facet fixes no palette, no
// font, no gem artwork, no board frame, no background, and no animation. There
// is not a single color or type face in this file, and there is not meant to be
// one. `specs/overview.md` and `specs/board.md` state what a player has to be
// able to read at a glance; how the board and its gems look is the build's to
// design, and `specs/assets.md` states which of it the build produces for
// itself.
//
// The two durations here are in SECONDS of game time, measured against the
// delta time the engine hands the game each frame, and `state.simTime`
// accumulates that same delta.

// ---- Stage ---------------------------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The stage center. */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

// ---- Board geometry (specs/board.md) -------------------------------------

/**
 * The board's dimensions. `col` runs left to right and `row` runs top to
 * bottom, so gravity pulls toward increasing `row`.
 */
export const GRID_COLS = 8;
export const GRID_ROWS = 8;

/** The distance between adjacent cell centers, on both axes. */
export const CELL_PITCH = 72;

/**
 * The point the board is centered on. A cell's center is
 *
 *   cellX(col) = BOARD_CX - (GRID_COLS - 1) * CELL_PITCH / 2 + col * CELL_PITCH
 *   cellY(row) = BOARD_CY - (GRID_ROWS - 1) * CELL_PITCH / 2 + row * CELL_PITCH
 *
 * The board therefore spans x 388..892 and y 144..648 from center to center,
 * leaving 144 above it for the readouts and 72 below it.
 */
export const BOARD_CX = 640;
export const BOARD_CY = 396;

/** Every gem's drawn form fits inside this radius of its cell center. */
export const GEM_R = 30;

/**
 * A gem is targeted by the pointer within this radius of its cell center. It is
 * half of CELL_PITCH, so at most one cell center lies strictly inside it;
 * specs/controls.md settles a position lying exactly this far from two.
 */
export const GEM_HIT_R = 36;

// ---- Gems (specs/board.md) -----------------------------------------------

/**
 * The seven kinds, in this order. A refill draws uniformly from this list, and
 * a run is three or more of one kind. The kinds are named for stones, and the
 * form and hue each one is drawn with are the build's to choose.
 */
export const GEM_KINDS = [
  "ruby",
  "amber",
  "citrine",
  "jade",
  "beryl",
  "sapphire",
  "amethyst",
] as const;

/** How many kinds a refill draws from. */
export const GEM_KIND_COUNT = 7;

/**
 * The four cuts, in this order. A `plain` gem is what a refill deals; the other
 * three are created by a run under the cut rules. A `prism` carries no kind.
 */
export const CUTS = ["plain", "brilliant", "star", "prism"] as const;

/** The strain a gem carries, a whole number from 0 to this. */
export const MAX_STRAIN = 3;

/** The shortest run of one kind that clears. */
export const MATCH_MIN = 3;

// ---- Chains (specs/rules.md) ---------------------------------------------

/** The game time one chain step holds before the board is read again. */
export const STEP_SECONDS = 0.25;

/** The game time a refused swap is marked for. */
export const REFUSAL_SECONDS = 0.3;

// ---- Scoring and levels (specs/rules.md) ---------------------------------

/**
 * The points a cleared gem below MAX_STRAIN is worth, before the multiplier.
 */
export const BASE_SCORE = 10;

/** The points a cleared gem at MAX_STRAIN is worth, before the multiplier. */
export const FLAWED_SCORE = 20;

/** The largest chain multiplier: `min(chainStep, MAX_MULTIPLIER)`. */
export const MAX_MULTIPLIER = 8;

/** The level target is this many points times the level: `2000 * level`. */
export const LEVEL_TARGET_STEP = 2000;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "FACET";
export const TAGLINE_TEXT = "PRESSURE FINDS THE FLAW";

/** The title menu, in this order. */
export const TITLE_ITEMS = ["PLAY", "HOW TO PLAY"] as const;

/** The pause screen: its heading and its menu, in this order. */
export const PAUSED_TITLE_TEXT = "PAUSED";
export const PAUSED_ITEMS = ["RESUME", "QUIT"] as const;

/** The end of a round: its heading and its menu, in this order. */
export const GAMEOVER_TITLE_TEXT = "NO MOVES LEFT";
export const GAMEOVER_ITEMS = ["PLAY AGAIN", "QUIT"] as const;

/** The three readouts on the `playing` screen. */
export const HUD_SCORE_LABEL = "SCORE";
export const HUD_LEVEL_LABEL = "LEVEL";
export const HUD_CHAIN_LABEL = "CHAIN";

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * The board is played with the pointer and with a cursor the keyboard moves, so
 * the four movement actions carry both the menu highlight and that cursor: a
 * four-way pad and the menu vocabulary that comes with it.
 */
export const LAYOUT = "dpad-4";

/**
 * Every action Facet registers, which is exactly the vocabulary LAYOUT brings:
 * the four movement actions and the menu actions appended to every layout.
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character.
 *
 * `specs/controls.md` fixes this whole table, and every key listed for an
 * action fires that action on its own, so both the arrow keys and WASD move
 * the cursor.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

/** The cell the cursor occupies when a round opens. */
export const CURSOR_START_COL = 0;
export const CURSOR_START_ROW = 0;

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The eight cue names, one per event. Define and play exactly these. */
export const CUES = {
  select: "select",
  swap: "swap",
  refuse: "refuse",
  clear: "clear",
  flaw: "flaw",
  cut: "cut",
  levelUp: "levelup",
  gameOver: "gameover",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const FACET_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;
