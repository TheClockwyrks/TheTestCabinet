// Fathom — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down). That space is the
// engine's logical design size: the engine scales and letterboxes it onto the
// canvas, so no value here is ever expressed in real pixels and gameplay never
// leaves logical space.
//
// Every rate is PER SECOND and every duration is in SECONDS. Fathom runs its
// simulation on the fixed timestep below rather than on the frame's own delta
// time, so a rate is integrated in whole ticks of TICK_DT.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Fathom fixes no palette, no
// font, no maze layout, no glow, and no screen composition. There is not a
// single color in this file, and there is not meant to be one.
// `specs/overview.md` states what a player has to be able to read at a glance;
// how the trench looks is the build's to design.

// ---- Stage ---------------------------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

// ---- The tile grid (specs/overview.md) -----------------------------------

/** One tile's size, on both axes. */
export const TILE = 32;

/** The grid's extent, in tiles. */
export const GRID_COLS = 36;
export const GRID_ROWS = 18;

/**
 * Column 0's left edge and row 0's top edge, so the maze region spans x in
 * [64, 1216] and y in [80, 656]. The center of tile (tx, ty) is
 *
 *   (GRID_ORIGIN_X + tx * TILE + TILE / 2, GRID_ORIGIN_Y + ty * TILE + TILE / 2)
 *
 * and the HUD occupies the strips above and below that region.
 */
export const GRID_ORIGIN_X = 64;
export const GRID_ORIGIN_Y = 80;

// ---- The fixed-step core (specs/movement.md) -----------------------------

/** Simulation steps per second, and the length of one step in seconds. */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;

// ---- Maze proportions (specs/maze.md) ------------------------------------

/**
 * The three measures every laid-out maze satisfies, each inclusive on both
 * ends and computed over the corridor tiles alone.
 */
export const MAZE_OPENNESS_MIN = 2.0; // mean corridor neighbors per corridor tile
export const MAZE_OPENNESS_MAX = 2.8;
export const MAZE_MAZING_MIN = 2.0; // mean corridor run length, in tiles
export const MAZE_MAZING_MAX = 8.0;
export const MAZE_DENSITY_MIN = 0.4; // corridor tiles over the 544 interior cells
export const MAZE_DENSITY_MAX = 1.0;

// ---- The forager (specs/movement.md) -------------------------------------

/** Four tiles per second, constant wherever the forager is in the maze. */
export const FORAGER_SPEED = 128;

// ---- Plankton and the bonus drifters (specs/gameplay.md) -----------------

/** A plankton mote's drawn size across, centered on its tile. */
export const PLANKTON_DOT = 6;

/** Two tiles per second: the drifter's pace, and a wandering Lanternjaw's. */
export const DRIFTER_SPEED = 64;

/** The cadence drifters are admitted on while plankton remain, in seconds. */
export const DRIFTER_INTERVAL = 25;

/** The most drifters the maze holds at once. */
export const DRIFTER_MAX = 2;

// ---- The forager's light and brightness (specs/sensing.md) ---------------

/**
 * The light pocket's radius, V = VISION_MIN + VISION_GAIN * G: 96 (3 tiles) at
 * G = 0 and 160 (5 tiles) at G = 1.
 */
export const VISION_MIN = 96;
export const VISION_GAIN = 64;

/** What one plankton adds to the brightness G, which is clamped at 1. */
export const BRIGHT_PER_EAT = 0.34;

/** The hold eating arms, in full each time, during which G is steady. */
export const BRIGHT_HOLD = 1.0;

/** Past the hold, G halves every this many seconds: G *= 0.5 ** (dt / 0.9). */
export const BRIGHT_HALFLIFE = 0.9;

// ---- The sonar pulse (specs/sensing.md, specs/progression.md) ------------

/** What emitting a pulse sets the cooldown to. */
export const SONAR_COOLDOWN = 1.5;

/**
 * The pulse's path range E in corridor steps, which shrinks one tile per depth
 * to its floor: E = max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (d - 1)).
 */
export const SONAR_RANGE_BASE = 9;
export const SONAR_RANGE_MIN = 5;

/** How fast a wavefront's front travels, in corridor steps per second. */
export const SONAR_WAVE_SPEED = 14;

/** How long a predator the front caught stays drawn, in seconds. */
export const SONAR_MARK_TIME = 1.5;

// ---- Ink (specs/sensing.md) ----------------------------------------------

/** What releasing a cloud sets the cooldown to. */
export const INK_COOLDOWN = 8;

/** The cloud's radius (2.5 tiles) and how long it stands, in seconds. */
export const INK_RADIUS = 80;
export const INK_LIFE = 3;

// ---- The predators, in common (specs/predators.md) -----------------------

/** The three kinds, as the snapshot reports them. */
export type PredatorKind = "lanternjaw" | "gloamfin" | "flarefish";

/**
 * The hunting pace: the Lanternjaw chasing, the Gloamfin wandering and
 * searching, and the Flarefish in every state.
 */
export const PREDATOR_SPEED = 116;

/** How long a detection alert reports and draws, from the acquisition. */
export const ALERT_TIME = 0.5;

/** How long a Lanternjaw or a Flarefish holds a lapsed fix before wandering. */
export const LINGER_TIME = 2;

/**
 * The gap between RELEASE TIMES in the den's staggered schedule, measured from
 * the moment live play begins. The first release time is 0 s, so the roster's
 * release times are 0 s, 5 s, 10 s, and so on in turn.
 */
export const DEN_RELEASE_GAP = 5;

/**
 * The order the den releases the first three predators in, which is also the
 * order the snapshot lists the roster in. A predator the roster adds beyond
 * these takes the next slot after the ones already there.
 */
export const DEN_ORDER: readonly PredatorKind[] = [
  "lanternjaw",
  "gloamfin",
  "flarefish",
];

/**
 * The kinds added one per depth beyond the first, cycled in this order, on top
 * of the one of each kind depth 1 holds.
 */
export const ROSTER_ADD_ORDER: readonly PredatorKind[] = [
  "gloamfin",
  "lanternjaw",
  "flarefish",
];

/**
 * From ROSTER_CAP_DEPTH on the roster holds at ROSTER_CAP of each kind, six
 * predators in all, for every deeper maze.
 */
export const ROSTER_CAP_DEPTH = 4;
export const ROSTER_CAP = 2;

// ---- The Lanternjaw (specs/predators/lanternjaw.md) ----------------------

/**
 * Its light detection range, R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G:
 * 128 (4 tiles) at G = 0 and 320 (10 tiles) at G = 1. The Flarefish senses on
 * the same curve.
 */
export const LANTERN_RANGE_BASE = 128;
export const LANTERN_RANGE_GAIN = 192;

// ---- The Gloamfin (specs/predators/gloamfin.md) --------------------------

/** How far its close-range hearing reaches, in logical units (2 tiles). */
export const GLOAMFIN_HEAR = 64;

/** Its chase speed's cap, above the forager's own speed. */
export const GLOAMFIN_CHASE_SPEED = 134;

/** What a corner drops the chase speed to, below the forager's own speed. */
export const GLOAMFIN_CORNER_SPEED = 115;

/** How long the chase speed takes to climb back to its cap after a corner. */
export const GLOAMFIN_RAMP_TIME = 2;

/** What casting a ping sets the ping timer to. */
export const GLOAMFIN_PING_INTERVAL = 4;

/** The floor between one ping and the next. */
export const GLOAMFIN_PING_MIN_GAP = 3;

/** A ping's path range, in corridor steps. */
export const GLOAMFIN_PING_RANGE = 9;

/** How far into a search the one guaranteed ping is cast. */
export const GLOAMFIN_SEARCH_DELAY = 1.2;

/** How far from the fixed tile a search casts about, in tiles. */
export const GLOAMFIN_SEARCH_ROAM = 2;

/** How long a search lasts before the fix is dropped, from the arrival. */
export const GLOAMFIN_GIVEUP = 5;

// ---- The Flarefish (specs/predators/flarefish.md) ------------------------

/** The bloom's lit radius, in logical units (6 tiles). */
export const FLARE_RADIUS = 192;

/** What the flare timer is set to as a bloom ends and on returning to wander. */
export const FLARE_INTERVAL = 7;

/** The charge-up glow, then the bloom, in seconds. */
export const FLARE_CHARGE = 0.5;
export const FLARE_BLOOM = 1;

// ---- Scoring, lives, and depth (specs/progression.md) --------------------

export const SCORE_PLANKTON = 10;
export const SCORE_DRIFTER = 200;
export const SCORE_CLEAR = 500;

/** The lives held in reserve at the start of a dive. */
export const START_LIVES = 3;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "FATHOM";
export const TAGLINE_TEXT = "HUNT IN THE DARK";

/** Each menu's items, in the order they are stacked. */
export const TITLE_ITEMS = ["DIVE", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const GAMEOVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/** The small, dim dive label on the HUD's top strip. */
export const DIVE_LABEL = "STANDARD";

// ---- Input actions (specs/movement.md) -----------------------------------

/** A four-way pad plus the two buttons the sonar pulse and the ink sit on. */
export const LAYOUT = "dpad-4-two-buttons";

/**
 * Every action Fathom registers, in the `dpad-4-two-buttons` layout's own
 * order: the layout's four movement actions and two buttons, followed by the
 * menu vocabulary every layout carries. This list equals
 * `TOUCH_LAYOUTS[LAYOUT].actions`.
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
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
 * `Space` deliberately drives TWO actions, `a` and `confirm`, and `Escape`
 * drives `back` and `pause`. Each screen reads the actions in its own row of
 * `specs/movement.md` and leaves the rest alone.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  a: ["Space"],
  b: ["ShiftLeft", "ShiftRight"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/progression.md) -----------------------------------

/** The seven cue names, one per event. Define and play exactly these. */
export const CUES = {
  eat: "eat",
  sonar: "sonar",
  ink: "ink",
  predatorPing: "predator-ping",
  flare: "flare",
  caught: "caught",
  descend: "descend",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const FATHOM_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;
