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

// ---- Obstacles (live: sway + rotate; oriented collision) ---------------
// The `Rect` type is still used for the axis-aligned paddle collision.
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Each obstacle is a rounded bar 20 wide x 140 tall — half-extents (10, 70) —
// centered at a base center. Its pose is a function of the obstacle clock `t`
// (seconds): the center y oscillates sinusoidally about the base y, and the bar
// rotates about its own center at a constant rate. The two obstacles sway in
// anti-phase so the layout stays point-symmetric about the field center
// (640, 360) and neither side is favored. See specs/obstacles.md.
export const OBSTACLE_HW = 10; // half-width (long axis is vertical at t = 0)
export const OBSTACLE_HH = 70; // half-height
export const OBSTACLE_SWAY_AMP = 80; // px
export const OBSTACLE_SWAY_PERIOD = 3.6; // s
export const OBSTACLE_SPIN = (60 * Math.PI) / 180; // rad/s (60 deg/s)

export interface ObstacleBase {
  cx: number;
  cy: number;
  swaySign: 1 | -1; // +1: y = cy + amp*sin;  -1: y = cy - amp*sin (anti-phase)
}

export const OBSTACLE_BASES: ObstacleBase[] = [
  { cx: 490, cy: 220, swaySign: 1 }, // A
  { cx: 790, cy: 500, swaySign: -1 }, // B
];

// A fixed obstacle-clock value used only to pose the dimmed obstacles behind
// the title menu, so the backdrop hints at the live, tilted obstacles.
export const TITLE_OBS_TIME = 0.37;

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
