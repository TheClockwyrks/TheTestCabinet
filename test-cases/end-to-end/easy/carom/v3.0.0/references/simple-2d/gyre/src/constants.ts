// Carom — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down). That space is the
// runtime's logical design size: the runtime scales and letterboxes it onto the
// canvas, so no value here is ever expressed in real pixels and gameplay never
// leaves logical space.
//
// Every rate is PER SECOND and every duration is in SECONDS, because the runtime
// hands the game the real elapsed seconds of each frame and imposes no timestep
// of its own. There is deliberately no fixed-step constant: nothing in this game
// counts frames.

// ---- Field ---------------------------------------------------------------

export const FIELD_W = 1280;
export const FIELD_H = 720;

/** The field center — the ball's home point and the AI's rest position. */
export const FIELD_CX = 640;
export const FIELD_CY = 360;

/** The dashed decorative net. It has no collision. */
export const NET_X = 640;

// ---- Paddles -------------------------------------------------------------

export const PADDLE_W = 16;
export const PADDLE_H = 110;
export const PADDLE_HALF = 55; // half height; also the divisor of the spin mechanic

// Left paddle occupies x in [48, 64]; right in [1216, 1232].
export const P1_X0 = 48;
export const P1_X1 = 64; // front (field-facing) face of the left paddle
export const P2_X0 = 1216; // front face of the right paddle
export const P2_X1 = 1232;

// Center y is clamped so a 110-tall paddle stays fully on the field.
export const PADDLE_MIN_CY = 55;
export const PADDLE_MAX_CY = FIELD_H - 55; // 665

export const PADDLE_SPEED = 720; // units per second while a movement action is held

// ---- Obstacles (mirror-symmetric about the field center) -----------------

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Point {
  x: number;
  y: number;
}

export const OBSTACLE_W = 20;
export const OBSTACLE_H = 140;
export const OBSTACLE_HW = 10; // half-extents used by the collision resolution
export const OBSTACLE_HH = 70;

/**
 * The two obstacle BASE centers, point-symmetric about (640, 360).
 *
 * An obstacle's base center is where its sway is measured from: its live
 * center oscillates about this point and its live orientation
 * rotates, both as functions of the obstacle clock (specs/playfield.md).
 */
export const OBSTACLE_CENTERS: readonly Point[] = [
  { x: 490, y: 220 }, // A
  { x: 790, y: 500 }, // B
];

/**
 * The two obstacles as axis-aligned rectangles about their BASE centers.
 *
 * These are the upright pose (obstacle clock 0). The collision resolves against
 * the oriented rectangle at each obstacle's live pose.
 */
export const OBSTACLES: readonly Rect[] = OBSTACLE_CENTERS.map((c) => ({
  x0: c.x - OBSTACLE_HW,
  y0: c.y - OBSTACLE_HH,
  x1: c.x + OBSTACLE_HW,
  y1: c.y + OBSTACLE_HH,
}));

// ---- Obstacle motion -----------------------------------------------------

/**
 * Peak vertical displacement of an obstacle from its base center, in units.
 *
 * The two obstacles sway in anti-phase: A by `+amp * sin(...)`, B by
 * `-amp * sin(...)`, so the layout stays point-symmetric about the field center.
 */
export const OBSTACLE_SWAY_AMP = 80;

/** Seconds for one full sway cycle. */
export const OBSTACLE_SWAY_PERIOD = 3.6;

/**
 * How fast an obstacle rotates about its own center, in RADIANS per second
 * (60 degrees per second). Both obstacles turn the same way, and the angle is
 * `OBSTACLE_SPIN_RATE * t`, so the clock's zero is the upright pose.
 */
export const OBSTACLE_SPIN_RATE = (60 * Math.PI) / 180;

// ---- Ball ----------------------------------------------------------------

export const BALL_R = 11;
export const SERVE_SPEED = 520;
export const SPEED_MULT = 1.04; // per paddle hit
export const SPEED_CAP = 980;

/**
 * The most units a ball's center travels in one physics sub-step. A frame is cut
 * into `max(1, ceil(speed * dt / MAX_SUBSTEP))` sub-steps (specs/balls.md).
 */
export const MAX_SUBSTEP = 4;

/** The outgoing angle from horizontal at the very edge of a paddle: 55deg. */
export const MAX_BOUNCE_ANGLE = (55 * Math.PI) / 180;

/** The serve's small fixed vertical component. */
export const SERVE_ANGLE = (12 * Math.PI) / 180;

// ---- Spin (the signature mechanic) ---------------------------------------

export const SPIN_FROM_PADDLE = 0.85; // spin += paddleVy * this, on a paddle hit
export const SPIN_CLAMP = 900;
export const SPIN_HALFLIFE = 0.8; // spin loses half its magnitude every 0.8 s

// ---- Timing --------------------------------------------------------------

export const HOLD_TIME = 1.0; // pre-serve hold, at match start and after a point
export const TRAIL_TIME = 0.13; // seconds of recent travel the motion trail draws

// ---- AI ------------------------------------------------------------------

export const AI_SPEED = 560; // top speed, in units per second
export const AI_REACT = 0.12; // reaction lag time constant, in seconds
export const AI_DEADZONE = 10; // stop within this of the target while defending
export const AI_HOME_Y = FIELD_CY; // returned to while there is nothing to defend
export const AI_HOME_DEADZONE = 18; // stop within this of AI_HOME_Y while returning

// ---- Match rules ---------------------------------------------------------

export const WIN_SCORE = 11;
export const WIN_LEAD = 2;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "CAROM";
export const TITLE_ITEMS = ["SOLO", "VERSUS", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const MATCHOVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;

// ---- Input actions (specs/ui.md) -----------------------------------------

/** Carom is two paddles facing each other: one vertical slider per side. */
export const LAYOUT = "dual-vertical";

/**
 * Every action Carom registers, in the `dual-vertical` layout's own order: the
 * layout's four movement actions followed by the menu vocabulary every layout
 * carries. This list must equal `TOUCH_LAYOUTS[LAYOUT].actions`.
 */
export const ACTIONS = [
  "p1-up",
  "p1-down",
  "p2-up",
  "p2-down",
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
 * `Escape` is bound to both `pause` and `back`; `specs/ui.md` states how each
 * screen resolves the two.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  "p1-up": ["KeyW"],
  "p1-down": ["KeyS"],
  "p2-up": ["ArrowUp"],
  "p2-down": ["ArrowDown"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP", "Escape"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/audio.md) -----------------------------------------

/** The cue names, one per event. `specs/audio.md` states when each plays. */
export const CUES = {
  paddleHit: "paddle-hit",
  wallBounce: "wall-bounce",
  obstacleBounce: "obstacle-bounce",
  score: "score",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const CAROM_DEBUG_VERSION = 1;

/** The seed the game's generator starts a fresh title screen from. */
export const DEFAULT_SEED = 1;
