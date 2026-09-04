// Spectra — every figure the specification fixes, restated on the validator's
// side. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS AT ALL. An engineless run seeds no `src/` — the build
// writes its own constants, under whatever names it likes, in a bundle this
// process cannot import. So a check that wanted a spec figure would have nowhere
// to get one, and the one place it could get one from is the build itself, which
// would be a check comparing a build's number against its own copy of that
// number. That grades nothing. Everything below is therefore read out of
// `specs/` and written here, under the name the specification gives it, so a
// check asserts the CASE's figure against the BUILD's behaviour.
//
// NOTHING HERE IS EVER READ FROM A BUILD, and nothing here is a tolerance. The
// figures are the specification's; the tolerance a check allows around one is
// the check's own business and is stated in the check, beside the figure it is a
// tolerance on (`guides/authoring/writing-debug-apis-and-validators.md`). A
// helper that carried a threshold would hide what the check is really asserting,
// so this file carries none — not a colour distance, not a percentage, not a
// frame budget.
//
// Every value is in the fixed 1280x720 logical space `specs/overview.md` fixes
// (origin top-left, x right, y down), every rate is per second, every duration is
// in seconds, and every position the surface takes or reports is an entity's
// CENTRE.

/* -------------------------------------------------------------------------- */
/* The stage and its three regions (specs/overview.md, specs/field.md)        */
/* -------------------------------------------------------------------------- */

/** The logical design size every build fits onto its canvas. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The top HUD strip: `y` in `[0, HUD_TOP_H]`. It carries the score and stage. */
export const HUD_TOP_H = 64;

/** The play field, where everything that moves is drawn. */
export const FIELD_TOP = 64;
export const FIELD_BOTTOM = 656;
export const FIELD_LEFT = 0;
export const FIELD_RIGHT = 1280;

/** The bottom HUD strip: `y` in `[HUD_BOTTOM_TOP, STAGE_H]`. */
export const HUD_BOTTOM_TOP = 656;

/** The fewest marks the starfield behind the play field holds. */
export const STARFIELD_MIN = 40;

/* -------------------------------------------------------------------------- */
/* The frame (specs/simulation.md)                                            */
/* -------------------------------------------------------------------------- */

/**
 * The furthest a single sub-step may carry anything, in seconds.
 *
 * A frame worth `dt` runs `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of
 * `h = dt / n`, so one second of game time covers exactly the same ground
 * whether it arrives as one frame, as sixty, or as a hundred and twenty. That is
 * what `instrumentation/deterministic-core` asserts as an identity rather than as
 * a tolerance.
 */
export const SUBSTEP_MAX = 1 / 120;

/* -------------------------------------------------------------------------- */
/* The ship and its cannon (specs/ship.md, specs/field.md)                    */
/* -------------------------------------------------------------------------- */

/** The ship's centre `y`, fixed for the whole run: it travels one lane. */
export const SHIP_Y = 600;
export const SHIP_W = 40;
export const SHIP_H = 28;
/** The ship's contact half-extent. */
export const SHIP_HALF = 15;
/** The bounds the ship's CENTRE is clamped to. */
export const SHIP_X_MIN = 40;
export const SHIP_X_MAX = 1240;
/** The ship's speed along its lane while a direction is held. */
export const SHIP_SPEED = 360;

/** The player's bullets: their speed, their drawn box, and their half-extent. */
export const PLAYER_BULLET_SPEED = 760;
export const PLAYER_BULLET_W = 4;
export const PLAYER_BULLET_H = 16;
export const PLAYER_BULLET_HALF = 6;

/** The cooldown one shot sets, the cap in flight, and the flip's fire lockout. */
export const FIRE_INTERVAL = 0.16;
export const MAX_PLAYER_BULLETS = 3;
export const FLIP_LOCKOUT = 0.3;

/* -------------------------------------------------------------------------- */
/* Enemy fire (specs/swarm.md)                                                */
/* -------------------------------------------------------------------------- */

/** An enemy bullet's stage-1 speed, straight down. */
export const ENEMY_BULLET_SPEED = 320;
export const ENEMY_BULLET_W = 6;
export const ENEMY_BULLET_H = 12;
export const ENEMY_BULLET_HALF = 8;

/* -------------------------------------------------------------------------- */
/* The formation grid and its sway (specs/field.md)                           */
/* -------------------------------------------------------------------------- */

/** The slot grid: `FORM_COLS` across by `FORM_ROWS` down, at these spacings. */
export const SLOT_DX = 64;
export const SLOT_DY = 48;
export const FORM_COLS = 9;
export const FORM_ROWS = 5;

/** The `x` the grid is centred on, which is also the centre of the ship's lane. */
export const FORM_CENTER_X = 640;
/** The centre `y` of the grid's top row. */
export const FORM_ROW0_Y = 140;

/** The sway's amplitude, in units either side of the slot, and its period. */
export const SWAY_AMP = 20;
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

/* -------------------------------------------------------------------------- */
/* The drones (specs/drones.md, specs/swarm.md)                               */
/* -------------------------------------------------------------------------- */

/** Each kind's drawn footprint. A Prism has two, by whether its shell stands. */
export const SHARD_SIZE = 28;
export const FLUX_SIZE = 30;
export const PRISM_SIZE = 56;
export const PRISM_CORE_SIZE = 26;

/** Each kind's contact half-extent. */
export const SHARD_HALF = 14;
export const FLUX_HALF = 15;
export const PRISM_HALF = 28;
export const PRISM_CORE_HALF = 13;

/** The entrance: its stage-1 speed, and the gap between two group releases. */
export const ENTER_SPEED = 260;
export const ENTER_GROUP_GAP = 0.6;

/** The dive: its stage-1 speed, its first delay, its later gaps, its fire line. */
export const DIVE_SPEED = 300;
export const DIVE_FIRST_DELAY = 2.0;
export const DIVE_GAP_MIN = 1.4;
export const DIVE_GAP_MAX = 2.6;
export const DIVE_FIRE_Y = 360;

/** A Flux's band window: the stage-1 held part, then the shimmer. */
export const FLUX_HOLD_L1 = 1.6;
export const FLUX_SHIMMER = 0.4;

/** A Prism's escorts, and the `y` its dive inverts the field at. */
export const PRISM_ESCORTS = 2;
export const PRISM_INVERT_Y = 640;

/* -------------------------------------------------------------------------- */
/* The bands and the inversion (specs/bands.md)                               */
/* -------------------------------------------------------------------------- */

/** A spectral band. There is no third value and no neutral state. */
export type Band = "cyan" | "magenta";

/** Both bands, in the order the specification names them. */
export const BANDS: readonly Band[] = ["cyan", "magenta"];

/** The other band. */
export function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** How long a spectral inversion lasts from the moment it begins. */
export const INVERSION_TIME = 5.0;

/* -------------------------------------------------------------------------- */
/* Resonance and the discharge (specs/resonance.md)                           */
/* -------------------------------------------------------------------------- */

/** The meter's ceiling, and the reading a discharge needs. */
export const RESONANCE_MAX = 100;
/** What absorbing an enemy bullet of the ship's own band adds. */
export const RESONANCE_ABSORB = 6;
/** What a matching kill by one of the player's bullets adds. */
export const RESONANCE_KILL = 4;
/** How long a discharge wave is live, and the radius it grows to. */
export const DISCHARGE_TIME = 0.5;
export const DISCHARGE_MAX_R = 1500;

/* -------------------------------------------------------------------------- */
/* The stages (specs/stages.md)                                               */
/* -------------------------------------------------------------------------- */

/** Every `CHALLENGE_EVERY`-th stage is a challenge stage. */
export const CHALLENGE_EVERY = 3;
/** A challenge stage's groups, the drones in one, and the total. */
export const CHALLENGE_GROUPS = 5;
export const CHALLENGE_PER_GROUP = 8;
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

/**
 * A Flux's whole band window at `stage`: the hold, then the shimmer.
 *
 * There is deliberately no flat `FLUX_CYCLE` here. `fluxHold(stage)` falls from
 * `FLUX_HOLD_L1` to a floor of `1.0`, so a caller could not know
 * `setDroneBandClock`'s legal argument domain at any stage but the first from a
 * flat constant. Every check that advances a Flux through a window or a cycle
 * names the stage it posed.
 */
export function fluxWindow(stage: number): number {
  return fluxHold(stage) + FLUX_SHIMMER;
}

/** A Flux's full cycle back to the same stored band at `stage`: two windows. */
export function fluxCycle(stage: number): number {
  return 2 * fluxWindow(stage);
}

/* -------------------------------------------------------------------------- */
/* The run (specs/progression.md, specs/ui.md)                                */
/* -------------------------------------------------------------------------- */

/** The lives a run starts with, and the score its one extra life is paid at. */
export const START_LIVES = 3;
export const EXTRA_LIFE_AT = 20000;

/** The three holds, in seconds. */
export const READY_HOLD = 1.3;
export const STAGE_INTRO_HOLD = 2.0;
export const STAGE_CLEARED_HOLD = 2.6;

/* -------------------------------------------------------------------------- */
/* Scoring (specs/scoring.md)                                                 */
/* -------------------------------------------------------------------------- */

/** A Shard, by whether it was resting in the formation or in motion. */
export const SCORE_SHARD_FORM = 50;
export const SCORE_SHARD_DIVE = 100;
/** A Flux, the same way. */
export const SCORE_FLUX_FORM = 80;
export const SCORE_FLUX_DIVE = 160;
/** A Prism's two layers, in any phase. */
export const SCORE_PRISM_SHELL = 100;
export const SCORE_PRISM_CORE = 400;
/** One drone of a challenge stage, and the bonus for taking every one. */
export const SCORE_CHALLENGE_DRONE = 100;
export const SCORE_PERFECT_BONUS = 10000;
/** A standard stage cleared. */
export const SCORE_STAGE_CLEAR = 1000;

/* -------------------------------------------------------------------------- */
/* The seeded art (specs/assets.md)                                           */
/* -------------------------------------------------------------------------- */

/** The square canvas every seeded sprite is drawn on. */
export const SPRITE_SIZE = 64;

/** The four seeded sprites, by the name each file carries under `assets/`. */
export const SPRITES = {
  fighter: "fighter.png",
  shard: "shard.png",
  flux: "flux.png",
  prism: "prism.png",
} as const;

/** The name of one seeded sprite. */
export type SpriteName = keyof typeof SPRITES;

/** The seeded particle system a destroyed drone pops with. */
export const BURST_SYSTEM = "drone-burst.json";
/** The square field that system is authored on. */
export const BURST_FIELD = 128;
/** How long one drone-burst plays, and the most that may play at once. */
export const BURST_DURATION = 0.7;
export const MAX_BURSTS = 24;

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/ui.md, specs/mode.md)                                   */
/* -------------------------------------------------------------------------- */

export const TITLE_TEXT = "SPECTRA";
export const TAGLINE_TEXT = "TUNE TO SURVIVE";

/**
 * The first item of `TITLE_ITEMS` is the mode entry, and the mode is the
 * variant's (`specs/mode.md`): `LAUNCH` under Sortie, `OVERLOAD` under Overload.
 *
 * One suite decides `screens/title-menu-items` for both variants, so it reads the
 * mode off the snapshot and asks {@link titleItems} for the copy that mode's
 * specification fixes, rather than carrying one variant's word.
 */
export const MODE_TITLE_ITEM: Readonly<Record<Mode, string>> = {
  sortie: "LAUNCH",
  overload: "OVERLOAD",
};

/** The second item of `TITLE_ITEMS`, which both modes share. */
export const HOWTO_ITEM = "HOW TO PLAY";

/** `TITLE_ITEMS` for the mode a build ships, in order. */
export function titleItems(mode: Mode): readonly string[] {
  return [MODE_TITLE_ITEM[mode], HOWTO_ITEM];
}

export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
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
export const BAND_LABELS: Readonly<Record<Band, string>> = {
  cyan: "CYAN",
  magenta: "MAGENTA",
};

/**
 * The standalone words `specs/ui.md` requires the how-to screen to name.
 *
 * Standalone, so `screens/howto-content` reads them with `drewWord` rather than
 * `drewText`: a screen reading "press the spacebar" contains `space` and has not
 * named the key the specification named.
 */
export const HOWTO_FIRE_KEY = "SPACE";
export const HOWTO_MOVE_KEYS = ["ARROWS", "AD"] as const;

/* -------------------------------------------------------------------------- */
/* The mode (specs/mode.md)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The mode a build ships, as `snapshot().mode` reports it.
 *
 * One validator project serves both variants — the runner names only the scripts
 * of the checklist the run selected — so a suite that must know which mode it is
 * grading reads it here rather than being compiled for one.
 */
export type Mode = "sortie" | "overload";

/* -------------------------------------------------------------------------- */
/* Overload (specs/mode.md — THE OVERLOAD VARIANT ONLY)                       */
/* -------------------------------------------------------------------------- */
//
// These figures exist only under the overload variant, and only the `overload/`
// suites read them. A base run never loads a suite that names one: its checklist
// carries the `sortie` items instead, and `setDroneCharge` is not on a base
// build's surface (see `OVERLOAD_OPS` in `harness.ts`).

/** The charge an overload happens at: the third mismatched shot. */
export const OVERLOAD_AT = 3;
/** What an overloaded Shard's plunge multiplies the dive speed by. */
export const OVERLOAD_DIVE_SCALE = 1.6;
/** The bullets an overloaded Flux sprays, and the degrees between them. */
export const OVERLOAD_FLUX_SPREAD = 3;
export const OVERLOAD_FLUX_SPREAD_ANGLE = 20;
/** The Shards an overloaded Prism with its shell still standing adds. */
export const OVERLOAD_PRISM_ESCORTS = 1;

/* -------------------------------------------------------------------------- */
/* Input (specs/controls.md)                                                  */
/* -------------------------------------------------------------------------- */

/** Every action Spectra answers to. */
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

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values, so a binding
 * is a physical key rather than a layout-dependent character.
 *
 * Under this engine there is no action layer between the page and the game: the
 * build's own runtime listens for these codes directly. What the table gives a
 * check is the key to dispatch and the action `specs/controls.md` says that key
 * drives. Several keys drive more than one action — `Space` drives `a` and
 * `confirm`, `ArrowUp` and `KeyW` drive `a` and `up`, `Escape` drives `back` and
 * `pause` — and the screen decides which one applies.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
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

/** The key the read-only debug overlay is shown and hidden by. */
export const OVERLAY_KEY = "Backquote";

/**
 * A key `specs/controls.md` binds to nothing.
 *
 * Pressing it is a genuine, browser-trusted gesture that opens a build's audio
 * without touching the game — which is what `Harness.armAudio` is for — and it is
 * what a check presses to prove a key the game ignores changes nothing.
 */
export const UNBOUND_KEY = "KeyZ";

/* -------------------------------------------------------------------------- */
/* Audio (specs/ui.md, specs/mode.md)                                         */
/* -------------------------------------------------------------------------- */

/**
 * The nine cues, under the names `specs/ui.md` gives them, and the tenth the
 * overload variant adds.
 *
 * A cue's NAME is unobservable under this engine: the whole audio layer is the
 * build's own Web Audio graph, with no bus to ask. So NO CHECK HERE MAY ASSERT A
 * NAME. What is observable is that a sound was emitted and on which driven frame,
 * which is what `watchCues` reports; the names are kept for the prose of a
 * failure message and for the engine-backed projects next door.
 */
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

/** The cue the overload variant adds beside the nine (`specs/mode.md`). */
export const OVERLOAD_CUE = "overload";

export type CueName = (typeof CUES)[number] | typeof OVERLOAD_CUE;

/* -------------------------------------------------------------------------- */
/* The debug surface (specs/instrumentation.md)                               */
/* -------------------------------------------------------------------------- */

/** The version the surface reports as `version`. */
export const SPECTRA_DEBUG_VERSION = 1;

/** The seed a bare `reset()` re-arms. */
export const DEFAULT_SEED = 1;
