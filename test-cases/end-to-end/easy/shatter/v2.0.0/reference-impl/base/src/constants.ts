// Shatter — canonical constants.
//
// Every value here is in the fixed 1280x720 logical-pixel coordinate space
// defined by the specification (origin top-left, x right, y down; angles are
// measured clockwise from the +x axis, so "up" is 270deg / -90deg). Rendering
// scales this space uniformly to the window; gameplay never leaves it.

export const FIELD_W = 1280;
export const FIELD_H = 720;

// ---- Palette (matches specs/overview.md) -------------------------------
export const COLOR = {
  bg: "#060910",
  bgRaised: "#0d1320",
  ship: "#6cf0ff",
  thrust: "#ffd166",
  thrustCore: "#fff2cc",
  bullet: "#f2f5f7",
  rock: "#9aa7bd",
  starCore: "#ffd27a",
  starHalo: "#ff7b3d",
  saucer: "#ff5c8a",
  text: "#e6edf3",
  textDim: "#8a94a6",
  textFaint: "#4a5567",
  panelBorder: "#20283a",
} as const;

// A system monospace stack: no downloaded web font, so the game renders
// identically offline.
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- Simulation --------------------------------------------------------
export const FIXED_STEP = 1 / 120; // physics timestep (Hz), decoupled from render
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

// ---- The star (gravity well) -------------------------------------------
export const STAR_X = 640;
export const STAR_Y = 360;
export const CORE_R = 30; // solid, impassable, non-lethal core
export const HALO_R = 120; // decorative halo fades to nothing here
export const MU = 4_500_000; // gravitational parameter (px^3 / s^2)
export const SOFTEN = 90; // softening radius: never divide by less

// ---- The ship ----------------------------------------------------------
export const SHIP_R = 14; // collision radius
export const SHIP_TURN = 300 * DEG; // rad/s
export const SHIP_THRUST = 480; // px/s^2 along facing
export const SHIP_DRAG_HALFLIFE = 3.0; // v halves roughly every 3 s of coasting
export const SHIP_MAX = 680; // px/s speed cap
export const SAFE_X = 640; // safe respawn point, below the star
export const SAFE_Y = 560;
export const FACE_UP = -90 * DEG; // facing straight up the screen (270deg)
export const INVULN_TIME = 2.5; // post-respawn invulnerability window (s)
export const START_LIVES = 3; // ships at the start of a game
export const EXTRA_LIFE_STEP = 10_000; // an extra ship per this many points

// ---- Bullets -----------------------------------------------------------
export const BULLET_R = 3;
export const MUZZLE_SPEED = 520; // added along the ship's facing, plus ship velocity
export const BULLET_LIFE = 1.5; // seconds
export const MAX_BULLETS = 4; // of the ship's bullets on screen at once
export const FIRE_INTERVAL = 0.18; // minimum seconds between shots
export const TRAIL_TIME = 0.16; // seconds of recent travel a bullet's motion trail spans

// ---- Rocks -------------------------------------------------------------
export type RockSize = "large" | "medium" | "small";

export interface RockSpec {
  radius: number; // collision radius
  speedMin: number; // base drift speed range (px/s)
  speedMax: number;
  score: number; // points when shot
}

export const ROCK: Record<RockSize, RockSpec> = {
  large: { radius: 46, speedMin: 60, speedMax: 110, score: 20 },
  medium: { radius: 26, speedMin: 90, speedMax: 150, score: 50 },
  small: { radius: 14, speedMin: 130, speedMax: 210, score: 100 },
};

// The child size a rock splits into (small splits into nothing).
export const ROCK_CHILD: Record<RockSize, RockSize | null> = {
  large: "medium",
  medium: "small",
  small: null,
};

export const SPLIT_KICK = 90; // px/s, perpendicular to the shot, fanning fragments

// ---- Waves -------------------------------------------------------------
export const WAVE_BASE_ROCKS = 3; // wave N spawns WAVE_BASE_ROCKS + N large rocks
export const WAVE_SPEED_STEP = 0.04; // +4% base drift per wave...
export const WAVE_SPEED_CAP = 0.4; // ...capped at +40%
export const WAVE_BANNER_TIME = 1.5; // seconds the WAVE N banner shows
export const WAVE_MIN_SHIP_DIST = 300; // spawn at least this far from the ship
export const WAVE_MIN_STAR_DIST = 200; // ...and this far from the star

// ---- The saucer --------------------------------------------------------
export const SAUCER_R = 18; // collision radius
export const SAUCER_SPEED = 140; // horizontal crossing speed (px/s)
export const SAUCER_WEAVE_SPEED = 90; // vertical weave speed (px/s)
export const SAUCER_WEAVE_INTERVAL = 1.0; // reroll the weave about this often (s)
export const SAUCER_AVOID_DIST = 118; // steer away from the star within this
export const SAUCER_FIRE_INTERVAL = 1.6; // seconds between saucer shots
export const SAUCER_AIM_ERROR = 10 * DEG; // +/- random aim error
export const SAUCER_BULLET_SPEED = 300; // px/s, plus the saucer's velocity
export const SAUCER_BULLET_LIFE = 1.4; // seconds
export const SAUCER_LIFETIME = 12; // despawn after this long...
export const SAUCER_MAX_TRAVEL = FIELD_W * 1.5; // ...or this much horizontal travel
export const SAUCER_SCORE = 200;
export const SAUCER_FIRST_DELAY = 18; // first saucer this many seconds into a game
export const SAUCER_GAP_MIN = 25; // subsequent saucers every 25..35 s
export const SAUCER_GAP_MAX = 35;

// ---- HUD ---------------------------------------------------------------
export const SCORE_X = 40; // score left edge
export const SCORE_Y = 28; // score top
export const SCORE_SIZE = 44;
export const LIVES_X = 44; // lives row start
export const LIVES_Y = 92;
