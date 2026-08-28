// Refract — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down). That space is the
// engine's logical design field: the engine scales and letterboxes it onto the
// canvas, and the game leaves the camera at rest, so world units and these
// logical units coincide, no value here is ever expressed in real pixels, and
// gameplay never leaves logical space. The pointer position the game reads is in
// these same units, so a hit test against a cell center needs no conversion.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Refract fixes no palette, no
// font, no node artwork, no beam rendering, no background, and no animation.
// There is not a single color or type face in this file, and there is not meant
// to be one. `specs/overview.md` and `specs/board.md` state what a player has to
// be able to read at a glance; how the optical bench looks is the build's to
// design.
//
// Refract runs no rates of its own — nothing here moves per second — but
// `state.simTime` accumulates the frame's delta time in SECONDS, because the
// engine hands each tick the real elapsed seconds of the frame and imposes no
// timestep of its own.

// ---- Stage ---------------------------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The stage center. */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

// ---- Board geometry (specs/board.md) -------------------------------------

/** The largest board a run of the game ever poses. */
export const GRID_MAX_COLS = 7;
export const GRID_MAX_ROWS = 6;

/** The distance between adjacent cell centers, on both axes. */
export const CELL_PITCH = 96;

/**
 * The point every board is centered on, whatever its dimensions, so the board
 * does not drift as boards change. A cell's center is
 *
 *   cellX(col, cols) = BOARD_CX - (cols - 1) * CELL_PITCH / 2 + col * CELL_PITCH
 *   cellY(row, rows) = BOARD_CY - (rows - 1) * CELL_PITCH / 2 + row * CELL_PITCH
 *
 * A board of the largest size therefore spans x 352..928 and y 152..632 from
 * center to center, leaving the heading above it and the footer below it.
 */
export const BOARD_CX = 640;
export const BOARD_CY = 392;

/** Every node's drawn form fits inside this radius of its cell center. */
export const NODE_R = 30;

/**
 * A node is targeted by the pointer within this radius of its cell center. It
 * is below half of CELL_PITCH (48), so no two targeting regions overlap and a
 * pointer position targets at most one node.
 */
export const NODE_HIT_R = 44;

// ---- Channels (specs/board.md) -------------------------------------------

/**
 * The three channel identifiers, in this order. Each carries one silhouette —
 * a triangle, a square, and a diamond — so channel identity reads by form as
 * well as by hue. The hues themselves are the build's to choose.
 */
export const CHANNELS = ["triangle", "square", "diamond"] as const;

export type ChannelName = (typeof CHANNELS)[number];

/** The largest charge count a crystal carries. */
export const MAX_CHARGES = 3;

// ---- Campaign (specs/modes/campaign.md) ----------------------------------

/**
 * The number of hand-built boards the campaign runs, laid out in
 * `specs/campaign-boards.md` and worked through in that order.
 */
export const CAMPAIGN_LENGTH = 24;

/** The select grid's row labels, one per set, top row down. */
export const SET_LABELS = ["SET A", "SET B", "SET C", "SET D"] as const;

// ---- Cascade's tier ladder (specs/modes/cascade.md) ----------------------

/** The number of rungs the ladder holds; the top rung holds indefinitely. */
export const MAX_TIER = 5;

/**
 * The tier climbs one rung every this many boards solved:
 * `tier = min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER)`, so the
 * ladder is five rungs of five boards each, and the top rung holds from the
 * twentieth solve onward.
 */
export const TIER_ADVANCE = 5;

/**
 * One rung of the ladder. The shape is this module's; every value in TIERS is
 * the specification's. A tier that carries no crystals states `0` for all four
 * crystal figures. The difficulty-floor fields carry the bounds of the
 * specification's "The floor, by tier" table; a bound the table does not
 * state is held at the loosest value of its kind, so every rung reads the
 * same way.
 */
export interface Tier {
  /** The tier this entry describes, `1` through MAX_TIER. */
  readonly tier: number;
  /** The grid the generator chooses from, inclusive on both ends. */
  readonly minCols: number;
  readonly maxCols: number;
  readonly minRows: number;
  readonly maxRows: number;
  /** How many of CHANNELS are present, taken from the front of that list. */
  readonly channels: number;
  /** How many crystals the board carries, inclusive on both ends. */
  readonly minCrystals: number;
  readonly maxCrystals: number;
  /** The charges each of those crystals carries, inclusive on both ends. */
  readonly minCharges: number;
  readonly maxCharges: number;
  /** The most cells a board at this tier leaves empty. */
  readonly maxEmptyCells: number;
  /** Routes per channel: every channel present admits at least this many. */
  readonly minRoutes: number;
  /** The solution count the board admits, inclusive on both ends. */
  readonly minSolutions: number;
  readonly maxSolutions: number;
  /** The determined share, at most, as a fraction of a solution's segments. */
  readonly maxDeterminedShare: number;
  /** The branching factor, at least. */
  readonly minBranching: number;
  /** Crystals crossed by two or more channels in one solution, at least. */
  readonly minSharedCrystals: number;
}

/** The ladder, one entry per tier, in tier order. */
export const TIERS: readonly Tier[] = [
  {
    tier: 1,
    minCols: 3,
    maxCols: 4,
    minRows: 3,
    maxRows: 4,
    channels: 1,
    minCrystals: 0,
    maxCrystals: 0,
    minCharges: 0,
    maxCharges: 0,
    maxEmptyCells: 6,
    minRoutes: 2,
    minSolutions: 1,
    maxSolutions: 64,
    maxDeterminedShare: 1,
    minBranching: 1.7,
    minSharedCrystals: 0,
  },
  {
    tier: 2,
    minCols: 4,
    maxCols: 5,
    minRows: 4,
    maxRows: 4,
    channels: 2,
    minCrystals: 0,
    maxCrystals: 1,
    minCharges: 1,
    maxCharges: 2,
    maxEmptyCells: 7,
    minRoutes: 2,
    minSolutions: 2,
    maxSolutions: 64,
    maxDeterminedShare: 0.95,
    minBranching: 1.7,
    minSharedCrystals: 0,
  },
  {
    tier: 3,
    minCols: 4,
    maxCols: 5,
    minRows: 4,
    maxRows: 5,
    channels: 2,
    minCrystals: 2,
    maxCrystals: 3,
    minCharges: 1,
    maxCharges: 2,
    maxEmptyCells: 9,
    minRoutes: 3,
    minSolutions: 2,
    maxSolutions: 128,
    maxDeterminedShare: 0.9,
    minBranching: 1.8,
    minSharedCrystals: 1,
  },
  {
    tier: 4,
    minCols: 5,
    maxCols: 6,
    minRows: 4,
    maxRows: 5,
    channels: 3,
    minCrystals: 3,
    maxCrystals: 5,
    minCharges: 1,
    maxCharges: 3,
    maxEmptyCells: 10,
    minRoutes: 3,
    minSolutions: 2,
    maxSolutions: 192,
    maxDeterminedShare: 0.85,
    minBranching: 1.9,
    minSharedCrystals: 2,
  },
  {
    tier: 5,
    minCols: 6,
    maxCols: 7,
    minRows: 5,
    maxRows: 6,
    channels: 3,
    minCrystals: 4,
    maxCrystals: 7,
    minCharges: 1,
    maxCharges: 3,
    maxEmptyCells: 14,
    minRoutes: 6,
    minSolutions: 2,
    maxSolutions: 256,
    maxDeterminedShare: 0.8,
    minBranching: 2,
    minSharedCrystals: 3,
  },
];

// ---- Screen copy (specs/ui.md, specs/modes/cascade.md) -------------------

export const TITLE_TEXT = "REFRACT";
export const TAGLINE_TEXT = "DRAW THE LIGHT";

/** The title menu, in this order. It is the only place a mode is chosen. */
export const TITLE_ITEMS = ["CAMPAIGN", "CASCADE", "HOW TO PLAY"] as const;

/** Cascade's solved screen: its heading and its menu, in this order. */
export const SOLVED_TITLE_TEXT = "BOARD SOLVED";
export const SOLVED_ITEMS = ["NEXT BOARD", "RESTART"] as const;

/** Cascade's two readouts on the `playing` screen. */
export const HUD_SOLVED_LABEL = "SOLVED";
export const HUD_TIER_LABEL = "TIER";

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * Refract's board is drawn with the pointer, so the only thing the keyboard
 * moves is a highlight: a four-way pad and the menu vocabulary that comes with
 * every layout.
 */
export const LAYOUT = "dpad-4";

/**
 * Every action Refract registers: the layout's four movement actions, the menu
 * vocabulary, and `clear`, which is Refract's own and sits beyond the layout.
 * A board is left by `back` rather than paused, so `pause` is not registered.
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "clear",
  "mute",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character.
 *
 * `specs/controls.md` fixes one of them: `clear` is `KeyR`. The rest are the
 * keys a player reaches for by habit, settled here so the whole set is named in
 * one place. Both the arrow keys and WASD move a highlight, since the hand that
 * has just let go of the pointer may arrive at either.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  clear: ["KeyR"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The five cue names, one per event. Define and play exactly these. */
export const CUES = {
  connect: "connect",
  retract: "retract",
  channelComplete: "channel-complete",
  solved: "solved",
  clear: "clear",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const REFRACT_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;
