// Carom — canonical constants.
//
// Every value here is in the fixed 1280x720 logical-pixel coordinate space
// defined by the specification (origin top-left, x right, y down). Rendering
// scales this space uniformly to the window; gameplay never leaves it.

export const FIELD_W = 1280;
export const FIELD_H = 720;

// ---- Palette (matches reference/theme.css) -----------------------------
export const COLOR = {
  bg: "#0b0e14",
  bgRaised: "#11151f",
  p1: "#3ae7c4", // player one / left paddle
  p2: "#ff5c8a", // player two / AI / right paddle
  ball: "#f2f5f7",
  obstacle: "#ffb454",
  net: "#243044",
  text: "#e6edf3",
  textDim: "#8a94a6",
  textFaint: "#4a5567",
  panelBorder: "#20283a",
} as const;

// A system monospace stack: no downloaded web font, so the game renders
// identically offline.
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- Paddles -----------------------------------------------------------
export const PADDLE_W = 16;
export const PADDLE_H = 110;
export const PADDLE_HALF = 55; // half height; used by the spin/angle mechanic

// Left paddle occupies x in [48, 64]; right in [1216, 1232].
export const P1_X0 = 48;
export const P1_X1 = 64; // front (field-facing) face of the left paddle
export const P2_X0 = 1216; // front face of the right paddle
export const P2_X1 = 1232;

// Center y is clamped so a 110-tall paddle stays fully on the field.
export const PADDLE_MIN_CY = 55;
export const PADDLE_MAX_CY = FIELD_H - 55; // 665

export const PADDLE_SPEED = 720; // logical px/s while a movement key is held

// ---- Obstacles (fixed, mirror-symmetric about the field center) --------
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const OBSTACLES: Rect[] = [
  { x0: 480, y0: 150, x1: 500, y1: 290 }, // A — center (490, 220)
  { x0: 780, y0: 430, x1: 800, y1: 570 }, // B — center (790, 500)
];

// ---- Ball --------------------------------------------------------------
export const BALL_R = 11;
export const SERVE_SPEED = 520;
export const SPEED_MULT = 1.04; // per paddle hit (normal / versus)
export const SPEED_CAP = 980;
export const MAX_BOUNCE_ANGLE = (55 * Math.PI) / 180; // radians
export const SERVE_ANGLE = (12 * Math.PI) / 180; // small fixed vertical component

// ---- Spin (signature mechanic) -----------------------------------------
export const SPIN_FROM_PADDLE = 0.85; // spin += paddleVy * this, on a hit
export const SPIN_CLAMP = 900;
export const SPIN_HALFLIFE = 0.8; // spin loses half its magnitude every 0.8 s

// ---- Timing ------------------------------------------------------------
export const HOLD_TIME = 1.0; // pre-serve hold, at match start and after a point
export const FIXED_STEP = 1 / 120; // physics timestep (Hz)
export const TRAIL_TIME = 0.13; // seconds of recent travel the comet represents

// ---- AI ----------------------------------------------------------------
export const AI_SPEED = 560; // deliberately slower than the human's 720
export const AI_REACT = 0.12; // reaction lag time constant
export const AI_DEADZONE = 10; // stop tracking within this of the target

// ---- Match rules -------------------------------------------------------
export const WIN_SCORE = 11;
export const WIN_LEAD = 2;

// ---- HUD layout --------------------------------------------------------
export const SCORE_P1_X = 520; // center x of player one's score
export const SCORE_P2_X = 760; // center x of player two's score
export const SCORE_TOP_Y = 40;
