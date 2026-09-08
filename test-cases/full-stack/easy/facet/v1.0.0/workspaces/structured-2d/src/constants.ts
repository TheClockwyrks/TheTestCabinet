// Facet — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down). That space is the
// engine's logical design field: the engine scales and letterboxes it onto the
// canvas, and the game leaves the camera at rest, so world units and these
// logical units coincide, no value here is ever expressed in real pixels, and
// gameplay never leaves logical space. The pointer position the game reads is
// in these same units, so a hit test against a cell center needs no
// conversion.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Facet fixes no palette, no
// font, no gem artwork, no board frame, no background, and no animation. There
// is not a single color or type face in this file, and there is not meant to be
// one. `specs/overview.md` and `specs/board.md` state what a player has to be
// able to read at a glance; how the board looks, and what the produced art in
// `public/assets/` carries, is the build's to design.
//
// The durations below are in SECONDS, because the engine hands each tick the
// real elapsed seconds of the frame and imposes no timestep of its own.

// ---- Stage ---------------------------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The stage center. */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

// ---- Board geometry (specs/board.md) -------------------------------------

/** The grid every board is dealt on. */
export const GRID_COLS = 8;
export const GRID_ROWS = 8;

/** The distance between adjacent cell centers, on both axes. */
export const CELL_PITCH = 72;

/**
 * The point the grid is centered on. A cell's center is
 *
 *   cellX(col) = BOARD_CX - (GRID_COLS - 1) * CELL_PITCH / 2 + col * CELL_PITCH
 *   cellY(row) = BOARD_CY - (GRID_ROWS - 1) * CELL_PITCH / 2 + row * CELL_PITCH
 *
 * so cell centers span x 388..892 and y 144..648, leaving 144 of stage above
 * the topmost row for the readouts and 72 below the bottom row.
 */
export const BOARD_CX = 640;
export const BOARD_CY = 396;

/** Every gem's drawn form fits inside this radius of its cell center. */
export const GEM_R = 30;

/**
 * A cell is targeted by the pointer within this radius of its cell center. It
 * is half of CELL_PITCH (72), so at most one cell center lies strictly inside
 * it; specs/controls.md settles a position lying exactly this far from two.
 */
export const GEM_HIT_R = 36;

// ---- Gems (specs/board.md) -----------------------------------------------

/**
 * The seven gem kinds, in this order. Each carries one hue and one form of its
 * own, so the seven are told apart by more than color; both are the build's to
 * choose.
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

/** How many kinds there are. */
export const GEM_KIND_COUNT = 7;

/**
 * The four cuts, in this order. `plain` is the cut a dealt gem arrives with;
 * the other three are created by a run under R8. A `prism` carries no kind.
 */
export const CUTS = ["plain", "brilliant", "star", "prism"] as const;

/** The highest strain a gem carries. A gem at MAX_STRAIN is flawed. */
export const MAX_STRAIN = 3;

// ---- The ruleset (specs/rules.md) ----------------------------------------

/** The shortest line of one kind that counts as a run under R4. */
export const MATCH_MIN = 3;

/** How long an accepted swap is in motion before its first step resolves. */
export const SWAP_SECONDS = 0.18;

/**
 * How far behind the wave before it one wave of a shattering clear set runs. R6
 * gives every cell of the set a wave, and the cell at wave `w` shatters `w` of
 * these into the step.
 */
export const WAVE_SECONDS = 0.08;

/** How long a falling gem takes per row it fell. */
export const FALL_SECONDS_PER_ROW = 0.05;

/**
 * How long a chain step rests once its gems have landed, before the board is
 * read again. The whole hold is
 * `lastWaves * WAVE_SECONDS + lastFall * FALL_SECONDS_PER_ROW + STEP_SECONDS`.
 */
export const STEP_SECONDS = 0.25;

/** A step whose longest fall was longer than this many rows plays `land`. */
export const LAND_MIN_ROWS = 2;

/** How long the mark on a refused swap stands. */
export const REFUSAL_SECONDS = 0.3;

/** The chain multiplier is min(chainStep, MAX_MULTIPLIER). */
export const MAX_MULTIPLIER = 8;

/** What one cleared gem is worth, before the chain multiplier. */
export const BASE_SCORE = 10;
export const FLAWED_SCORE = 20;

/** The level target is LEVEL_TARGET_STEP * level. */
export const LEVEL_TARGET_STEP = 2000;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "FACET";
export const TAGLINE_TEXT = "PRESSURE FINDS THE FLAW";

/** The title menu, in this order. */
export const TITLE_ITEMS = ["PLAY", "HOW TO PLAY"] as const;

/** The pause screen: its heading and its menu, in this order. */
export const PAUSED_TITLE_TEXT = "PAUSED";
export const PAUSED_ITEMS = ["RESUME", "QUIT"] as const;

/** The end of a level: its heading and its menu, in this order. */
export const LEVELCLEAR_TITLE_TEXT = "LEVEL CLEAR";
export const LEVELCLEAR_ITEMS = ["CONTINUE", "QUIT"] as const;

/** The end of a round: its heading and its menu, in this order. */
export const GAMEOVER_TITLE_TEXT = "NO MOVES LEFT";
export const GAMEOVER_ITEMS = ["PLAY AGAIN", "QUIT"] as const;

/** The three labeled readouts on the `playing` screen. */
export const HUD_SCORE_LABEL = "SCORE";
export const HUD_LEVEL_LABEL = "LEVEL";
export const HUD_CHAIN_LABEL = "CHAIN";

/** The two figures a finished level is reported by, on `levelclear`. */
export const BEST_CHAIN_LABEL = "LONGEST CHAIN";
export const BEST_MOVE_LABEL = "BEST MOVE";

/** The two on-screen controls a pointer-only player reaches a screen through. */
export const PAUSE_LABEL = "PAUSE";
export const BACK_LABEL = "BACK";

// ---- Pointer targets (specs/controls.md) ---------------------------------

/**
 * The least a pointer target may measure, in logical units. A fingertip covers
 * far more of a touchscreen than a mouse cursor covers of a monitor, so a target
 * smaller than this is one a touch player cannot reliably hit.
 */
export const TARGET_MIN_W = 96;
export const TARGET_MIN_H = 72;

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * Facet's board is played with the pointer alone, so the keyboard's whole job is
 * the menus: one vertical highlight and the menu vocabulary that comes with it.
 */
export const LAYOUT = "single-vertical";

/**
 * Every action Facet registers, which is exactly the vocabulary LAYOUT brings:
 * the two movement actions and the menu actions appended to every layout.
 */
export const ACTIONS = [
  "up",
  "down",
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
 * `specs/controls.md` fixes this whole table, and every key listed for an action
 * fires that action on its own. Escape is listed twice on purpose: it raises the
 * pause menu from the board and it backs out of every other screen that can be
 * backed out of, and the two actions act on screens that do not overlap, so a
 * frame that fires both is unambiguous whichever it applies first.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The nine cue names, one per event. Define and play exactly these. */
export const CUES = {
  select: "select",
  swap: "swap",
  refuse: "refuse",
  clear: "clear",
  land: "land",
  flaw: "flaw",
  cut: "cut",
  levelUp: "levelup",
  gameOver: "gameover",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const FACET_DEBUG_VERSION = 1;
