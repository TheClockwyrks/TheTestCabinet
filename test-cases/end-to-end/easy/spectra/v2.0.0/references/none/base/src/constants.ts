// Spectra — every figure the specification fixes, named once.
//
// The specification states each of these under a name, and this file is the one
// place the build writes the value down. Nothing here is a look: no colour, no
// font stack, no layout figure beyond the stage's own geometry — those are the
// build's own, and they live in `src/theme.ts`.
//
// Every position is a CENTRE, every length is in the logical units of the fixed
// `STAGE_W x STAGE_H` stage, every rate is per second and every duration is in
// seconds (specs/overview.md, specs/field.md, specs/simulation.md).

// ---------------------------------------------------------------------------
// The stage and its three regions (specs/field.md)
// ---------------------------------------------------------------------------

/** The logical design width the game draws in. */
export const STAGE_W = 1280;
/** The logical design height the game draws in. */
export const STAGE_H = 720;

/** The top HUD strip is `y` in `[0, HUD_TOP_H]`. */
export const HUD_TOP_H = 64;
/** The play field's top edge. A drone enters by crossing it downward. */
export const FIELD_TOP = 64;
/** The play field's bottom edge. A dive may leave below it. */
export const FIELD_BOTTOM = 656;
/** The bottom HUD strip is `y` in `[HUD_BOTTOM_TOP, STAGE_H]`. */
export const HUD_BOTTOM_TOP = 656;
/** The play field's left edge. */
export const FIELD_LEFT = 0;
/** The play field's right edge. */
export const FIELD_RIGHT = 1280;

/** The fewest marks the starfield behind the play field holds. */
export const STARFIELD_MIN = 40;

// ---------------------------------------------------------------------------
// The frame (specs/simulation.md)
// ---------------------------------------------------------------------------

/**
 * The furthest a single sub-step may carry anything, in seconds.
 *
 * A frame worth `dt` runs `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of
 * `h = dt / n`, so one second of game time covers exactly the same ground
 * whether it arrives as one frame, as sixty, or as a hundred and twenty.
 */
export const SUBSTEP_MAX = 1 / 120;

// ---------------------------------------------------------------------------
// The ship and its cannon (specs/ship.md, specs/field.md)
// ---------------------------------------------------------------------------

/** The ship's centre `y`, fixed for the whole run: it travels one lane. */
export const SHIP_Y = 600;
/** The ship's drawn width. */
export const SHIP_W = 40;
/** The ship's drawn height. */
export const SHIP_H = 28;
/** The ship's contact half-extent. */
export const SHIP_HALF = 15;
/** The leftmost centre `x` the lane's clamp allows. */
export const SHIP_X_MIN = 40;
/** The rightmost centre `x` the lane's clamp allows. */
export const SHIP_X_MAX = 1240;
/** The ship's speed along its lane while a direction is held. */
export const SHIP_SPEED = 360;

/** A player bullet's speed, straight up. */
export const PLAYER_BULLET_SPEED = 760;
/** A player bullet's drawn width. */
export const PLAYER_BULLET_W = 4;
/** A player bullet's drawn height. */
export const PLAYER_BULLET_H = 16;
/** A player bullet's contact half-extent. */
export const PLAYER_BULLET_HALF = 6;
/** The fire cooldown a shot sets. */
export const FIRE_INTERVAL = 0.16;
/** The most of the player's bullets that may be in flight at once. */
export const MAX_PLAYER_BULLETS = 3;
/** The fire lockout a flip starts. */
export const FLIP_LOCKOUT = 0.3;

// ---------------------------------------------------------------------------
// Enemy fire (specs/swarm.md)
// ---------------------------------------------------------------------------

/** An enemy bullet's stage-1 speed, straight down. */
export const ENEMY_BULLET_SPEED = 320;
/** An enemy bullet's drawn width. */
export const ENEMY_BULLET_W = 6;
/** An enemy bullet's drawn height. */
export const ENEMY_BULLET_H = 12;
/** An enemy bullet's contact half-extent. */
export const ENEMY_BULLET_HALF = 8;

// ---------------------------------------------------------------------------
// The formation grid and its sway (specs/field.md)
// ---------------------------------------------------------------------------

/** Horizontal spacing between two formation slots. */
export const SLOT_DX = 64;
/** Vertical spacing between two formation slots. */
export const SLOT_DY = 48;
/** Columns of the formation grid. */
export const FORM_COLS = 9;
/** Rows of the formation grid. */
export const FORM_ROWS = 5;
/** The `x` the grid is centred on, and the axis its layout mirrors about. */
export const FORM_CENTER_X = 640;
/** The centre `y` of the grid's top row. */
export const FORM_ROW0_Y = 140;
/** The sway's amplitude, in logical units either side of the slot. */
export const SWAY_AMP = 20;
/** The sway's period, in seconds. */
export const SWAY_PERIOD = 5;

/** The centre `x` of slot column `col`, before the sway. */
export function slotX(col: number): number {
  return FORM_CENTER_X + SLOT_DX * (col - (FORM_COLS - 1) / 2);
}

/** The centre `y` of slot row `row`. */
export function slotY(row: number): number {
  return FORM_ROW0_Y + SLOT_DY * row;
}

/**
 * The whole formation's horizontal offset at sway-clock `t`.
 *
 * Every slotted drone carries the same offset at the same instant, so the block
 * translates as one rigid body and its shape never changes.
 */
export function swayOffset(t: number): number {
  return SWAY_AMP * Math.sin((2 * Math.PI * t) / SWAY_PERIOD);
}

// ---------------------------------------------------------------------------
// The drones (specs/drones.md, specs/swarm.md)
// ---------------------------------------------------------------------------

/** A Shard's drawn footprint. */
export const SHARD_SIZE = 28;
/** A Flux's drawn footprint. */
export const FLUX_SIZE = 30;
/** A Prism's drawn footprint with its shell intact. */
export const PRISM_SIZE = 56;
/** A Prism's drawn footprint with only its core left. */
export const PRISM_CORE_SIZE = 26;

/** A Shard's contact half-extent. */
export const SHARD_HALF = 14;
/** A Flux's contact half-extent. */
export const FLUX_HALF = 15;
/** A Prism's contact half-extent with its shell intact. */
export const PRISM_HALF = 28;
/** A Prism's contact half-extent with only its core left. */
export const PRISM_CORE_HALF = 13;

/** The stage-1 speed a drone travels its entrance path at. */
export const ENTER_SPEED = 260;
/** The gap between one entry group's release and the next. */
export const ENTER_GROUP_GAP = 0.6;
/** The stage-1 speed a drone travels a dive or a return at. */
export const DIVE_SPEED = 300;
/** The dive clock the wave's first dive launches at. */
export const DIVE_FIRST_DELAY = 2.0;
/** The shortest gap a later dive launch may draw. */
export const DIVE_GAP_MIN = 1.4;
/** The longest gap a later dive launch may draw. */
export const DIVE_GAP_MAX = 2.6;
/** The `y` a diver's centre first crossing downward takes its first shot at. */
export const DIVE_FIRE_Y = 360;

/** The stage-1 held part of a Flux's band window, in seconds. */
export const FLUX_HOLD_L1 = 1.6;
/** The shimmering part of a Flux's band window, in seconds. */
export const FLUX_SHIMMER = 0.4;

/** The Shards that fly in alongside a Prism, one of each band. */
export const PRISM_ESCORTS = 2;
/** The `y` a diving Prism's centre crossing downward inverts the field at. */
export const PRISM_INVERT_Y = 640;

// ---------------------------------------------------------------------------
// The bands and the inversion (specs/bands.md)
// ---------------------------------------------------------------------------

/** A spectral band. There is no third value and no neutral state. */
export type Band = "cyan" | "magenta";

/** The other band. */
export function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** How long a spectral inversion lasts from the moment it begins. */
export const INVERSION_TIME = 5.0;

// ---------------------------------------------------------------------------
// Resonance and the discharge (specs/resonance.md)
// ---------------------------------------------------------------------------

/** The resonance meter's ceiling, and the reading a discharge needs. */
export const RESONANCE_MAX = 100;
/** What absorbing an enemy bullet of the ship's own band adds. */
export const RESONANCE_ABSORB = 6;
/** What a matching kill by one of the player's bullets adds. */
export const RESONANCE_KILL = 4;
/** How long a discharge wave is live. */
export const DISCHARGE_TIME = 0.5;
/** The radius a discharge wave grows to over its life. */
export const DISCHARGE_MAX_R = 1500;

// ---------------------------------------------------------------------------
// The stages (specs/stages.md)
// ---------------------------------------------------------------------------

/** Every `CHALLENGE_EVERY`-th stage is a challenge stage. */
export const CHALLENGE_EVERY = 3;
/** The groups a challenge stage sends across the field. */
export const CHALLENGE_GROUPS = 5;
/** The drones in one challenge group. */
export const CHALLENGE_PER_GROUP = 8;
/** Every drone a challenge stage holds. */
export const CHALLENGE_TOTAL = CHALLENGE_GROUPS * CHALLENGE_PER_GROUP;

/** Whether `stage` is a challenge stage rather than a standard wave. */
export function isChallengeStage(stage: number): boolean {
  return stage % CHALLENGE_EVERY === 0;
}

/** What a standard stage multiplies the entrance and dive speeds by. */
export function droneSpeedScale(stage: number): number {
  return Math.min(1.5, 1 + 0.06 * (stage - 1));
}

/** What a standard stage multiplies the enemy bullet speed by. */
export function bulletSpeedScale(stage: number): number {
  return Math.min(1.4, 1 + 0.04 * (stage - 1));
}

/** What a standard stage multiplies a drawn dive gap by. */
export function diveGapScale(stage: number): number {
  return Math.max(0.55, 1 - 0.05 * (stage - 1));
}

/** The held part of a Flux's band window at `stage`, in seconds. */
export function fluxHold(stage: number): number {
  return Math.max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1));
}

/** A Flux's whole band window at `stage`: the hold, then the shimmer. */
export function fluxWindow(stage: number): number {
  return fluxHold(stage) + FLUX_SHIMMER;
}

/** A Flux's full cycle back to the same stored band at `stage`. */
export function fluxCycle(stage: number): number {
  return 2 * fluxWindow(stage);
}

// ---------------------------------------------------------------------------
// The run (specs/progression.md, specs/ui.md)
// ---------------------------------------------------------------------------

/** The lives a run starts with. */
export const START_LIVES = 3;
/** The score the run's one extra life is paid at. */
export const EXTRA_LIFE_AT = 20000;
/** How long the `ready` phase holds after a life is lost. */
export const READY_HOLD = 1.3;
/** How long the stage-intro hold lasts before the wave opens. */
export const STAGE_INTRO_HOLD = 2.0;
/** How long the stage-cleared interstitial lasts. */
export const STAGE_CLEARED_HOLD = 2.6;

// ---------------------------------------------------------------------------
// Scoring (specs/scoring.md)
// ---------------------------------------------------------------------------

/** A Shard destroyed in phase `formation`. */
export const SCORE_SHARD_FORM = 50;
/** A Shard destroyed in phase `entering`, `diving`, or `returning`. */
export const SCORE_SHARD_DIVE = 100;
/** A Flux destroyed in phase `formation`. */
export const SCORE_FLUX_FORM = 80;
/** A Flux destroyed in phase `entering`, `diving`, or `returning`. */
export const SCORE_FLUX_DIVE = 160;
/** A Prism's shell, broken in any phase. */
export const SCORE_PRISM_SHELL = 100;
/** A Prism's exposed core, destroyed in any phase. */
export const SCORE_PRISM_CORE = 400;
/** One drone of a challenge stage. */
export const SCORE_CHALLENGE_DRONE = 100;
/** Every one of a challenge stage's drones destroyed. */
export const SCORE_PERFECT_BONUS = 10000;
/** A standard stage cleared. */
export const SCORE_STAGE_CLEAR = 1000;

// ---------------------------------------------------------------------------
// The seeded art (specs/assets.md)
// ---------------------------------------------------------------------------

/** The square canvas every seeded sprite is drawn on. */
export const SPRITE_SIZE = 64;

/** The four seeded sprites, by the name each file carries under `assets/`. */
export const SPRITES = {
  fighter: "fighter.png",
  shard: "shard.png",
  flux: "flux.png",
  prism: "prism.png",
} as const;

/** The seeded particle system a destroyed drone pops with. */
export const BURST_SYSTEM = "drone-burst.json";
/** The square field the burst system is authored on. */
export const BURST_FIELD = 128;
/** How long one drone-burst plays. */
export const BURST_DURATION = 0.7;
/** The most drone-bursts that may play at once. */
export const MAX_BURSTS = 24;

// ---------------------------------------------------------------------------
// Screen copy (specs/ui.md, specs/mode.md)
// ---------------------------------------------------------------------------

/** The title. */
export const TITLE_TEXT = "SPECTRA";
/** The tagline under the title. */
export const TAGLINE_TEXT = "TUNE TO SURVIVE";
/** The title menu: this build's mode entry, then how to play. */
export const TITLE_ITEMS = ["LAUNCH", "HOW TO PLAY"] as const;
/** The pause menu. */
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
/** The game-over menu. */
export const GAME_OVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;
/** The label beside the stage's digits. */
export const HUD_STAGE_LABEL = "STAGE";
/** The banner a challenge stage's intro carries. */
export const CHALLENGE_BANNER = "CHALLENGING STAGE";
/** The banner the `ready` phase draws over the field. */
export const READY_TEXT = "READY";
/** What a challenge stage with every drone destroyed reports. */
export const PERFECT_TEXT = "PERFECT!";
/** Each band's label, as the polarity indicator and the how-to name it. */
export const BAND_LABELS: Record<Band, string> = {
  cyan: "CYAN",
  magenta: "MAGENTA",
};

// ---------------------------------------------------------------------------
// The debug and automation surface (specs/instrumentation.md)
// ---------------------------------------------------------------------------

/** The version `window.__spectra` reports. */
export const SPECTRA_DEBUG_VERSION = 1;
/** The seed a bare `reset()` re-arms. */
export const DEFAULT_SEED = 1;
/** The `KeyboardEvent.code` that shows and hides the debug overlay. */
export const OVERLAY_KEY = "Backquote";

// ---------------------------------------------------------------------------
// The keyboard (specs/controls.md)
// ---------------------------------------------------------------------------

/** Every action the game answers to. */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "discharge",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

/** One of the game's actions. */
export type ActionName = (typeof ACTIONS)[number];

/**
 * The `KeyboardEvent.code` values that drive each action.
 *
 * Several keys deliberately drive more than one action — `Space` drives `a` and
 * `confirm`, `ArrowUp` and `KeyW` drive `a` and `up`, `Escape` drives `back` and
 * `pause` — and the screen decides which one applies, by `SCREEN_ACTIONS`.
 */
export const BINDINGS: Record<ActionName, readonly string[]> = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  a: ["Space", "ArrowUp", "KeyW"],
  b: ["KeyF", "ShiftLeft", "ShiftRight"],
  discharge: ["KeyX"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
};

// ---------------------------------------------------------------------------
// Audio (specs/ui.md)
// ---------------------------------------------------------------------------

/** The nine cues, under exactly the names the specification gives them. */
export const CUES = [
  "fire",
  "flip",
  "absorb",
  "kill",
  "discharge",
  "inversion",
  "hit",
  "stage-clear",
  "menu",
] as const;

/** One of the game's nine cues. */
export type CueName = (typeof CUES)[number];
