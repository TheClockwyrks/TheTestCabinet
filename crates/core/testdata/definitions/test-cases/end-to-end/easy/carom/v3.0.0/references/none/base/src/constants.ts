// Carom — the figures the specification fixes.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation
// (specs/overview.md asks for exactly this). Every other module reads its figures
// from here rather than restating them. Nothing about the LOOK is here: the
// specification leaves the palette, the type, and the HUD layout to the build, and
// this build's choices for them live in `src/theme.ts`.
//
// Every value is in the fixed 1280x720 logical-pixel coordinate space defined by
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

/** The field center — the ball's spawn point and the AI's rest position. */
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

// ---- Obstacles (fixed, mirror-symmetric about the field center) ----------

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

/** The two fixed obstacle centers, point-symmetric about (640, 360). */
export const OBSTACLE_CENTERS: readonly Point[] = [
  { x: 490, y: 220 }, // A
  { x: 790, y: 500 }, // B
];

/** The same two obstacles as axis-aligned rectangles. */
export const OBSTACLES: readonly Rect[] = OBSTACLE_CENTERS.map((c) => ({
  x0: c.x - OBSTACLE_HW,
  y0: c.y - OBSTACLE_HH,
  x1: c.x + OBSTACLE_HW,
  y1: c.y + OBSTACLE_HH,
}));

// ---- Ball ----------------------------------------------------------------

export const BALL_R = 11;
export const SERVE_SPEED = 520;
export const SPEED_MULT = 1.04; // per paddle hit
export const SPEED_CAP = 980;

/** The outgoing angle from horizontal at the very edge of a paddle: 55deg. */
export const MAX_BOUNCE_ANGLE = (55 * Math.PI) / 180;

/** The serve's angle from horizontal: 12deg, its sign the one random draw. */
export const SERVE_ANGLE = (12 * Math.PI) / 180;

/**
 * The most units a ball's center travels in one physics sub-step. A frame is cut
 * into `max(1, ceil(speed * dt / MAX_SUBSTEP))` sub-steps, so the ball can never
 * skip past a paddle, wall, or obstacle in one move.
 */
export const MAX_SUBSTEP = 4;

// ---- Spin (the signature mechanic) ---------------------------------------

export const SPIN_FROM_PADDLE = 0.85; // spin += paddleVy * this, on a paddle hit
export const SPIN_CLAMP = 900;
export const SPIN_HALFLIFE = 0.8; // spin loses half its magnitude every 0.8 s

// ---- Timing --------------------------------------------------------------

export const HOLD_TIME = 1.0; // pre-serve hold, at match start and after a point
export const TRAIL_TIME = 0.13; // seconds of recent travel the comet represents

// ---- AI ------------------------------------------------------------------

export const AI_SPEED = 560; // deliberately slower than the human's 720
export const AI_REACT = 0.12; // reaction lag time constant, in seconds
export const AI_DEADZONE = 10; // stop tracking within this of the target
export const AI_HOME_Y = FIELD_CY; // eased back to while the ball moves away
export const AI_HOME_DEADZONE = 18; // stop distance while returning home

// ---- Match rules ---------------------------------------------------------

export const WIN_SCORE = 11;
export const WIN_LEAD = 2;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "CAROM";
export const TITLE_ITEMS = ["SOLO", "VERSUS", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const MATCHOVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;

// ---- Input actions (specs/modes/*.md) ------------------------------------

/**
 * Every action Carom speaks: one vertical slider per side — Carom is two paddles
 * facing each other — followed by the four menu actions. `src/input.ts` registers
 * exactly this list with the runtime, each bound to the keys below.
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
 * `Escape` deliberately drives TWO actions, `pause` and `back` — one key meaning
 * "get me out of here", which is a pause during a match and a step back on a
 * menu. The game reads whichever of the two the current screen calls for.
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

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The four cue names, one per event. Define and play exactly these. */
export const CUES = {
  paddleHit: "paddle-hit",
  wallBounce: "wall-bounce",
  obstacleBounce: "obstacle-bounce",
  score: "score",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The surface's version, reported as `version` and bumped when it changes. */
export const CAROM_DEBUG_VERSION = 1;
