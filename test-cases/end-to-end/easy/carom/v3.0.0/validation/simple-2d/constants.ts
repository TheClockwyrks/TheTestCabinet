// Carom — the figures this case's specification fixes. CASE-PROVIDED.
//
// The build is seeded a `src/constants.ts` of its own, holding these same
// figures under these same names (specs/overview.md, "Every figure comes from
// `src/constants.ts`"). This project does not read it. A check that imported
// `SERVE_SPEED` from the build's module and then asserted the serve against it
// would be comparing the build with itself — true of every build, including one
// that serves at some other speed, and true however far the build's copy has
// drifted from the specification that seeded it. The figure a check grades by
// has to sit on the validator's side of the line.
//
// So this file is that side. Every value below is transcribed from the seeded
// specification the build was given, under the name that specification uses, and
// nothing here is read out of the build. The pairing is deliberate —
// `SERVE_SPEED` here is `specs/balls.md`'s serve speed, and a build that serves
// at some other speed fails the point rather than moving the target.
//
// One module, every variant: this project runs against base, gyre and multi, so
// figures only one of them has — the obstacle motion, the three ball homes, the
// fifth cue — are stated here for whichever variant is running.
//
// Every value is in the fixed 1280x720 logical-pixel coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down), every rate is per
// second, and every duration is in seconds.

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
 * The two obstacle centers, point-symmetric about (640, 360).
 *
 * In the base variant these are where the obstacles stand. In gyre they are the
 * BASE centers each obstacle sways about and rotates around
 * (specs/playfield.md).
 */
export const OBSTACLE_CENTERS: readonly Point[] = [
  { x: 490, y: 220 }, // A
  { x: 790, y: 500 }, // B
];

/**
 * The same two obstacles as axis-aligned rectangles about those centers.
 *
 * In gyre this is the upright pose alone — the pose at obstacle clock 0 — since
 * the collision that variant resolves is against the oriented rectangle at each
 * obstacle's live pose.
 */
export const OBSTACLES: readonly Rect[] = OBSTACLE_CENTERS.map((c) => ({
  x0: c.x - OBSTACLE_HW,
  y0: c.y - OBSTACLE_HH,
  x1: c.x + OBSTACLE_HW,
  y1: c.y + OBSTACLE_HH,
}));

// ---- Obstacle motion (the gyre variant alone) ----------------------------

/**
 * Peak vertical displacement of an obstacle from its base center, in px. The two
 * sway in ANTI-PHASE, so the layout stays point-symmetric at every instant.
 */
export const OBSTACLE_SWAY_AMP = 80;

/** Seconds for one full sway cycle. */
export const OBSTACLE_SWAY_PERIOD = 3.6;

/**
 * How fast an obstacle rotates about its own center, in RADIANS per second
 * (60 degrees per second). Both turn the same way, and the angle is
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

// ---- The three balls (the multi variant alone) ---------------------------

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

/** How many balls are in play at once. */
export const BALL_COUNT = BALL_HOMES.length;

/** Two balls are in contact when their centers are closer than this. */
export const BALL_COLLIDE_DIST = 2 * BALL_R;

// ---- Spin (the signature mechanic) ---------------------------------------

export const SPIN_FROM_PADDLE = 0.85; // spin += paddleVy * this, on a paddle hit
export const SPIN_CLAMP = 900;
export const SPIN_HALFLIFE = 0.8; // spin loses half its magnitude every 0.8 s

// ---- Timing --------------------------------------------------------------

export const HOLD_TIME = 1.0; // pre-serve hold, at match start and after a point
export const TRAIL_TIME = 0.13; // seconds of recent travel the motion trail draws

// ---- AI ------------------------------------------------------------------

export const AI_SPEED = 560; // deliberately slower than the human's 720
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

// ---- Input actions (specs/modes/single-player.md, specs/modes/versus.md) --

/**
 * The touch layout the game's actions are registered on.
 *
 * Both mode specifications name it outright — "the controls are registered
 * actions on the `LAYOUT` (`dual-vertical`) touch layout" — so it is the case's
 * figure, not the build's, and the harness states it when it stands the engine
 * up rather than asking the build which layout it chose. Carom is two paddles
 * facing each other: one vertical slider per side.
 */
export const LAYOUT = "dual-vertical";

// ---- Key bindings (specs/modes/single-player.md, specs/modes/versus.md) ---
//
// `KeyboardEvent.code` values, because a binding is a physical key rather than a
// layout-dependent character — and because that is the vocabulary a check presses
// in. The runtime resolves the action: a check dispatches the physical key at the
// target the engine listens on, the engine raises whichever action the build
// registered under that key, and the check reads the game moving. Both mode
// specifications fix every row of the table below, so a build that bound `p1-up`
// elsewhere fails the control it moved rather than moving the target.
//
// `Escape` deliberately drives TWO actions, `pause` and `back`.
export const BINDINGS = {
  "p1-up": ["KeyW"],
  "p1-down": ["KeyS"],
  "p2-up": ["ArrowUp"],
  "p2-down": ["ArrowDown"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP", "Escape"],
  mute: ["KeyM"],
} as const;

// ---- Audio cues (specs/ui.md) --------------------------------------------

/**
 * The cue names, one per event. `specs/ui.md` fixes both the names and the event
 * each one belongs to, and requires the build to define and play exactly these
 * and no others.
 *
 * `ballBounce` is the multi variant's alone — two balls meeting, played once for
 * the pair — and the other two variants raise the remaining four only. All five
 * are stated here because one module serves every variant; a check names only
 * the cue its own variant's event raises.
 */
export const CUES = {
  paddleHit: "paddle-hit",
  wallBounce: "wall-bounce",
  obstacleBounce: "obstacle-bounce",
  ballBounce: "ball-bounce",
  score: "score",
} as const;
