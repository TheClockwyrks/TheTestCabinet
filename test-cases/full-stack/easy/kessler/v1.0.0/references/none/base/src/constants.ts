// Kessler — every figure the specification fixes, in one place.
//
// The stage, the field geometry and its contact radii (`specs/field.md`), the
// deflector and ball figures (`specs/deflector-and-ball.md`), the three rings
// (`specs/rings.md`), the salvage pods and their effects (`specs/pods.md`), the
// scores (`specs/scoring.md`), the screens and their menu copy
// (`specs/screens.md`), the actions and key bindings (`specs/controls.md`), and
// the cue names (`specs/assets.md`). Nothing here computes; the modules that do
// import from here so a figure lives exactly once.

// --- The stage and the tick (specs/overview.md) ---

/** The fixed square logical stage, in logical units per side. */
export const STAGE_SIZE = 1000;
/** The stage center the polar mapping is measured from, on each axis. */
export const CENTER = 500;
/** Simulation ticks per second of game time. */
export const TICK_HZ = 60;
/** The game time one tick is worth, in seconds. */
export const TICK_DT = 1 / TICK_HZ;
/** The seed a fresh session gives the pod generator (specs/pods.md). */
export const DEFAULT_SEED = 1;

// --- The field (specs/field.md) ---

/** The planet disc's radius. */
export const PLANET_RADIUS = 70;
/** A ball or pod whose center radius reaches this or less burns up. */
export const BURN_RADIUS = 78;
/** The shield ring's drawn radius, while a shield is active. */
export const SHIELD_RADIUS = 92;
/** The shield's ball contact radius, crossed inward. */
export const SHIELD_CONTACT_RADIUS = 100;
/** The deflector track annulus, inner radius. */
export const TRACK_INNER_RADIUS = 170;
/** The deflector track annulus, outer radius. */
export const TRACK_OUTER_RADIUS = 186;
/** The deflector's ball contact radius, crossed inward within the span. */
export const PADDLE_CONTACT_RADIUS = 194;
/** The deflector's pod catch radius, crossed inward within the span. */
export const POD_CATCH_RADIUS = 196;
/** The deflector's baseline span, in degrees. */
export const BASE_SPAN_DEG = 48;
/** The containment field's drawn radius. */
export const CONTAINMENT_RADIUS = 480;
/** The containment field's ball contact radius, crossed outward. */
export const CONTAINMENT_CONTACT_RADIUS = 472;
/** The ball's own radius. */
export const BALL_RADIUS = 8;
/** A salvage pod's own radius. */
export const POD_RADIUS = 10;

// --- The deflector and the ball (specs/deflector-and-ball.md) ---

/** How fast a held rotation action turns the deflector, in degrees per second. */
export const PADDLE_TURN_RATE = 270;
/** The deflector's center angle when a session starts. */
export const PADDLE_START_ANGLE = 90;
/** The most balls in play at once, the parked ball included. */
export const BALL_CAP = 6;
/** The degrees of english per degree of offset in the deflector bounce. */
export const ENGLISH_PER_OFFSET_DEG = 1.2;
/** The bounce clamp: the outgoing angle from the radial stays within this. */
export const BOUNCE_CLAMP_DEG = 60;
/** The fraction of a moving ring's surface velocity a target hit adds. */
export const RING_KICK_FACTOR = 0.5;
/** The most degrees one orbital decay rotates a reflected velocity. */
export const DECAY_MAX_DEG = 6;

/** The ball speed of wave `w`: `240 + 30 * (w - 1)`, capped at `480`. */
export function ballSpeedForWave(wave: number): number {
  return Math.min(240 + 30 * (wave - 1), 480);
}

// --- The rings (specs/rings.md, radii from specs/field.md) ---

/** The structural gap at each side of a slot, in degrees. */
export const SLOT_GAP_DEG = 2;

/** One ring's fixed figures. Rings are indexed `0` to `2` for rings 1 to 3. */
export interface RingSpec {
  /** How many slots the ring holds. */
  readonly slots: number;
  /** One slot's width, in degrees. */
  readonly slotWidthDeg: number;
  /** One target's arc width, in degrees. */
  readonly arcDeg: number;
  /** A fresh target's hit points. */
  readonly hitPoints: number;
  /** The annulus, inner radius. */
  readonly innerRadius: number;
  /** The annulus, outer radius. */
  readonly outerRadius: number;
  /** The ball contact radius on the planet side. */
  readonly innerContactRadius: number;
  /** The ball contact radius on the containment side. */
  readonly outerContactRadius: number;
  /** The ring's mid radius, where a shed pod spawns (specs/pods.md). */
  readonly midRadius: number;
  /** The points destroying one of the ring's targets awards. */
  readonly destroyScore: number;
  /** The ring's orbit speed at wave `w`, signed, in degrees per second. */
  speedForWave(wave: number): number;
}

/** The three rings, ring 1 (the innermost) first. */
export const RINGS: readonly RingSpec[] = [
  {
    slots: 12,
    slotWidthDeg: 30,
    arcDeg: 26,
    hitPoints: 1,
    innerRadius: 290,
    outerRadius: 314,
    innerContactRadius: 282,
    outerContactRadius: 322,
    midRadius: 302,
    destroyScore: 100,
    speedForWave: () => 0,
  },
  {
    slots: 16,
    slotWidthDeg: 22.5,
    arcDeg: 18.5,
    hitPoints: 2,
    innerRadius: 360,
    outerRadius: 384,
    innerContactRadius: 352,
    outerContactRadius: 392,
    midRadius: 372,
    destroyScore: 200,
    speedForWave: (wave) => Math.min(12 + 3 * (wave - 1), 45),
  },
  {
    slots: 20,
    slotWidthDeg: 18,
    arcDeg: 14,
    hitPoints: 1,
    innerRadius: 430,
    outerRadius: 454,
    innerContactRadius: 422,
    outerContactRadius: 462,
    midRadius: 442,
    destroyScore: 300,
    speedForWave: (wave) => -Math.min(8 + 2 * (wave - 1), 30),
  },
];

// --- Salvage pods and effects (specs/pods.md) ---

/** The five pod kinds, in the order their `u2` bands sit in `[0, 1)`. */
export const POD_KINDS = [
  "widen",
  "multiball",
  "shield",
  "pierce",
  "narrow",
] as const;

/** One salvage pod kind. */
export type PodKind = (typeof POD_KINDS)[number];

/** The chance a destruction sheds a pod: it does at `u1 < 0.25`. */
export const POD_DROP_CHANCE = 0.25;

/**
 * The kind the second draw `u2` lands on: `widen` on `[0, 0.25)`, `multiball`
 * on `[0.25, 0.45)`, `shield` on `[0.45, 0.65)`, `pierce` on `[0.65, 0.80)`,
 * and `narrow` on `[0.80, 1)`.
 */
export function podKindForRoll(u2: number): PodKind {
  if (u2 < 0.25) return "widen";
  if (u2 < 0.45) return "multiball";
  if (u2 < 0.65) return "shield";
  if (u2 < 0.8) return "pierce";
  return "narrow";
}

/** How fast a pod falls radially inward, in logical units per second. */
export const POD_FALL_SPEED = 120;
/** The deflector's span while `widen` is in force, in degrees. */
export const WIDEN_SPAN_DEG = 72;
/** The deflector's span while `narrow` is in force, in degrees. */
export const NARROW_SPAN_DEG = 30;
/** The whole-tick duration of `widen` and of `narrow`. */
export const SPAN_EFFECT_TICKS = 600;
/** The whole-tick duration of `pierce`. */
export const PIERCE_EFFECT_TICKS = 360;
/** How far off the outward radial each multiball ball heads, in degrees. */
export const MULTIBALL_SPLIT_DEG = 20;

// --- Scoring and lives (specs/scoring.md) ---

/** A hit that leaves the target alive. */
export const SCORE_HIT = 50;
/** Catching a salvage pod. */
export const SCORE_POD_CATCH = 25;
/** The clearing event on wave `w` awards `500 * w`. */
export const WAVE_BONUS_PER_WAVE = 500;
/** The lives a fresh session starts with. */
export const START_LIVES = 3;

// --- Screens (specs/screens.md) ---

/** The six screens, in the order the specification lists them. */
export const SCREENS = [
  "title",
  "howto",
  "playing",
  "waveclear",
  "paused",
  "gameover",
] as const;

/** The screen the game is on. */
export type ScreenName = (typeof SCREENS)[number];

/** How many ticks the wave-clear interstitial runs. */
export const INTERSTITIAL_TICKS = 180;
/** The title screen's menu copy, indexed from `0` at the top. */
export const TITLE_MENU = ["START", "HOW TO PLAY"] as const;
/** The pause screen's menu copy, indexed from `0` at the top. */
export const PAUSE_MENU = ["RESUME", "QUIT"] as const;
/** The game's title, as the title screen shows it. */
export const GAME_TITLE = "KESSLER";
/** The game-over screen's heading. */
export const GAME_OVER_HEADING = "GAME OVER";

// --- Controls (specs/controls.md) ---

/** The actions the game registers. */
export const ACTIONS = [
  "left",
  "right",
  "up",
  "down",
  "confirm",
  "launch",
  "back",
  "pause",
] as const;

/** One registered action. */
export type Action = (typeof ACTIONS)[number];

/** The keys that fire each action, named by `KeyboardEvent.code`. */
export const BINDINGS: Record<Action, readonly string[]> = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  confirm: ["Space", "Enter"],
  launch: ["Space"],
  back: ["Escape"],
  pause: ["KeyP"],
};

/** The actions read as held values; every other action is a press edge. */
export const HELD_ACTIONS = [
  "left",
  "right",
] as const satisfies readonly Action[];

/** The `KeyboardEvent.code` that toggles the debug overlay. */
export const OVERLAY_TOGGLE_CODE = "Backquote";

// --- Audio and effects (specs/assets.md) ---

/** The thirteen cues, each named for the produced file that plays it. */
export const CUES = [
  "paddle-bounce",
  "field-bounce",
  "target-hit",
  "target-break",
  "shield-reflect",
  "pod-catch",
  "pod-catch-narrow",
  "pod-burn",
  "ball-lost",
  "wave-clear",
  "game-over",
  "menu-move",
  "menu-select",
] as const;

/** One cue name. */
export type Cue = (typeof CUES)[number];

/** The three produced particle systems, named for their files. */
export const PARTICLE_SYSTEMS = ["burst", "spark", "burnup"] as const;

/** One particle system name. */
export type ParticleSystem = (typeof PARTICLE_SYSTEMS)[number];

/** How many frames the produced ball spin sheet holds. */
export const BALL_FRAME_COUNT = 6;
/** How many simulation ticks each ball spin frame shows for. */
export const BALL_FRAME_TICKS = 5;

/**
 * The actions each screen answers (`specs/controls.md` "What each screen
 * reads"). An action a row omits does nothing on that screen, and the runtime
 * routes a press against the screen that was up when the key arrived — so the
 * `Space` that confirms START is not also the `launch` of the play screen it
 * opens (`Space` carries both actions, and the two never answer on the same
 * screen).
 */
export const SCREEN_ACTIONS: Record<ScreenName, readonly Action[]> = {
  title: ["up", "down", "confirm"],
  howto: ["confirm", "back"],
  playing: ["left", "right", "launch", "back", "pause"],
  waveclear: [],
  paused: ["up", "down", "confirm", "back", "pause"],
  gameover: ["confirm"],
};
