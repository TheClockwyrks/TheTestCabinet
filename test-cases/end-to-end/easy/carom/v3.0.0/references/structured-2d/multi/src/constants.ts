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
// hands every tick the frame's real elapsed seconds and imposes no timestep of
// its own. There is deliberately no fixed-step constant: nothing in this game
// counts frames.

import type { ActionBinding } from "@clockwyrks/structured-2d";

// ---- Field ---------------------------------------------------------------

export const FIELD_W = 1280;
export const FIELD_H = 720;

/** The field center — the middle ball's home point and the AI's rest position. */
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

/**
 * The most units a ball's center travels in one physics sub-step. A frame is cut
 * into `max(1, ceil(fastest * dt / MAX_SUBSTEP))` sub-steps, with `fastest` the
 * highest speed among the balls in flight, and every ball takes the same number
 * of sub-steps (specs/balls.md).
 */
export const MAX_SUBSTEP = 4;

/** The outgoing angle from horizontal at the very edge of a paddle: 55deg. */
export const MAX_BOUNCE_ANGLE = (55 * Math.PI) / 180;

// ---- The three balls -----------------------------------------------------

/**
 * Each ball's fixed home point, in play order.
 *
 * A ball always returns to its OWN home, and every launch leaves at a fresh
 * uniformly random angle over the full circle, so no home carries a serve
 * direction (specs/balls.md).
 */
export const BALL_HOMES: readonly Point[] = [
  { x: 640, y: 180 },
  { x: 640, y: 360 }, // the field center
  { x: 640, y: 540 },
];

export const BALL_COUNT = BALL_HOMES.length;

/** Two balls are in contact when their centers are closer than this. */
export const BALL_COLLIDE_DIST = 2 * BALL_R;

// ---- Spin (the signature mechanic) ---------------------------------------

export const SPIN_FROM_PADDLE = 0.85; // spin += paddleVy * this, on a paddle hit
export const SPIN_CLAMP = 900;
export const SPIN_HALFLIFE = 0.8; // spin loses half its magnitude every 0.8 s

// ---- Timing --------------------------------------------------------------

export const HOLD_TIME = 1.0; // each ball's own hold, before its own launch
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

// ---- Levels and actor tags (specs/state.md) ------------------------------

/**
 * The names the level registry is keyed by, and the only levels the game has:
 * `title`, the menu level the engine opens first, and `match`, the level a
 * match plays in. Which screens each level hosts is the game's to arrange.
 */
export const LEVELS = {
  title: "title",
  match: "match",
} as const;

export type LevelName = (typeof LEVELS)[keyof typeof LEVELS];

/**
 * The tag each of the field's bodies carries, so `world.byTag` finds them under
 * the names the specification uses. Each paddle carries its own side's tag;
 * every ball carries `ball`, spawned in play order — the order of `BALL_HOMES`
 * — so `world.byTag` lists them by ball index; both obstacles carry
 * `obstacle`, spawned in the order of `OBSTACLE_CENTERS`.
 */
export const TAGS = {
  paddleLeft: "paddle-left",
  paddleRight: "paddle-right",
  ball: "ball",
  obstacle: "obstacle",
} as const;

export type TagName = (typeof TAGS)[keyof typeof TAGS];

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
 * The binding each action is registered under, ready to hand to
 * `api.input.register`. Keys are `KeyboardEvent.code` values so a binding is a
 * physical key rather than a layout-dependent character; every action is
 * digital, so no binding names a kind.
 *
 * `Escape` is bound to both `pause` and `back`; `specs/ui.md` states how each
 * screen resolves the two.
 */
export const BINDINGS: Readonly<Record<ActionName, ActionBinding>> = {
  "p1-up": { keys: ["KeyW"] },
  "p1-down": { keys: ["KeyS"] },
  "p2-up": { keys: ["ArrowUp"] },
  "p2-down": { keys: ["ArrowDown"] },
  confirm: { keys: ["Enter", "Space"] },
  back: { keys: ["Escape"] },
  pause: { keys: ["KeyP", "Escape"] },
  mute: { keys: ["KeyM"] },
};

// ---- Audio cues (specs/audio.md) -----------------------------------------

/** The cue names, one per event. `specs/audio.md` states when each plays. */
export const CUES = {
  paddleHit: "paddle-hit",
  wallBounce: "wall-bounce",
  obstacleBounce: "obstacle-bounce",
  ballBounce: "ball-bounce",
  score: "score",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const CAROM_DEBUG_VERSION = 1;

