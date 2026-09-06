// Kessler — the specification's figures, in the simulation's own vocabulary.
//
// `src/constants.ts` is supplied with the project and holds every figure the
// specification fixes; this module derives from it — and from nowhere else —
// the names and shapes the simulation modules read by. The two formula tables
// (`ballSpeedForWave`, each ring's `speedForWave`) and the pod-kind lookup are
// built here from the constants that state them, so a figure still lives in
// exactly one place. Nothing below is a new number.

import {
  BALL_SPEED_BASE,
  BALL_SPEED_CAP,
  BALL_SPEED_PER_WAVE,
  BALL_SPIN_FRAMES,
  BINDINGS as ACTION_BINDINGS,
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_BASE_SPAN_DEG,
  DEFLECTOR_POD_CATCH_RADIUS,
  DEFLECTOR_START_ANGLE_DEG,
  DEFLECTOR_TRACK_INNER,
  DEFLECTOR_TRACK_OUTER,
  DEFLECTOR_TURN_DEG_PER_SEC,
  ENGLISH_DEG_PER_OFFSET_DEG,
  FIELD_CONTACT_RADIUS,
  FIELD_RADIUS,
  GAMEOVER_TEXT,
  HIT_SCORE,
  ORBITAL_DECAY_DEG,
  PARTICLE_PATHS,
  PAUSE_ITEMS,
  POD_CATCH_SCORE,
  POD_KIND_TABLE,
  RINGS as RING_TABLE,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  STRUCTURAL_GAP_DEG,
  TICK_DT as TICK_DT_SECONDS,
  TITLE_ITEMS,
  TITLE_TEXT,
  WAVECLEAR_TICKS,
  WAVE_CLEAR_BONUS_PER_WAVE,
  type ActionName,
  type CueName,
  type PodKind,
  type Screen,
} from "./constants";
import {
  BALL_CAP,
  BALL_FRAME_TICKS,
  BALL_RADIUS,
  BOUNCE_CLAMP_DEG,
  BURNUP_RADIUS,
  MULTIBALL_OFFSET_DEG,
  NARROW_DURATION_TICKS,
  NARROW_SPAN_DEG,
  PIERCE_DURATION_TICKS,
  PLANET_RADIUS,
  POD_DROP_CHANCE,
  POD_FALL_SPEED,
  POD_RADIUS,
  RING_KICK_FACTOR,
  SHIELD_CONTACT_RADIUS,
  SHIELD_RADIUS,
  START_LIVES,
  START_WAVE,
  TICK_HZ,
  WIDEN_DURATION_TICKS,
  WIDEN_SPAN_DEG,
} from "./constants";

// --- The stage and the tick (specs/overview.md) ---

/** The fixed square logical stage, in logical units per side. */
export const STAGE_SIZE = STAGE_W;
/** The stage center the polar mapping is measured from, on each axis. */
export const CENTER = STAGE_CX;

export {
  BALL_CAP,
  BALL_FRAME_TICKS,
  BALL_RADIUS,
  BOUNCE_CLAMP_DEG,
  NARROW_SPAN_DEG,
  PLANET_RADIUS,
  POD_DROP_CHANCE,
  POD_FALL_SPEED,
  POD_RADIUS,
  RING_KICK_FACTOR,
  SHIELD_CONTACT_RADIUS,
  SHIELD_RADIUS,
  START_LIVES,
  START_WAVE,
  TICK_HZ,
  WIDEN_SPAN_DEG,
  type PodKind,
};

/** The game time one tick is worth, in seconds. */
export const TICK_DT = TICK_DT_SECONDS;

// --- The field (specs/field.md) ---

/** A ball or pod whose center radius reaches this or less burns up. */
export const BURN_RADIUS = BURNUP_RADIUS;
/** The deflector track annulus, inner radius. */
export const TRACK_INNER_RADIUS = DEFLECTOR_TRACK_INNER;
/** The deflector track annulus, outer radius. */
export const TRACK_OUTER_RADIUS = DEFLECTOR_TRACK_OUTER;
/** The deflector's ball contact radius, crossed inward within the span. */
export const PADDLE_CONTACT_RADIUS = DEFLECTOR_BALL_CONTACT_RADIUS;
/** The deflector's pod catch radius, crossed inward within the span. */
export const POD_CATCH_RADIUS = DEFLECTOR_POD_CATCH_RADIUS;
/** The deflector's baseline span, in degrees. */
export const BASE_SPAN_DEG = DEFLECTOR_BASE_SPAN_DEG;
/** The containment field's drawn radius. */
export const CONTAINMENT_RADIUS = FIELD_RADIUS;
/** The containment field's ball contact radius, crossed outward. */
export const CONTAINMENT_CONTACT_RADIUS = FIELD_CONTACT_RADIUS;

// --- The deflector and the ball (specs/deflector-and-ball.md) ---

/** How fast a held rotation action turns the deflector, in degrees/second. */
export const PADDLE_TURN_RATE = DEFLECTOR_TURN_DEG_PER_SEC;
/** The deflector's center angle when a session starts. */
export const PADDLE_START_ANGLE = DEFLECTOR_START_ANGLE_DEG;
/** The degrees of english per degree of offset in the deflector bounce. */
export const ENGLISH_PER_OFFSET_DEG = ENGLISH_DEG_PER_OFFSET_DEG;
/** The most degrees one orbital decay rotates a reflected velocity. */
export const DECAY_MAX_DEG = ORBITAL_DECAY_DEG;

/** The ball speed of wave `w`: `240 + 30 * (w - 1)`, capped at `480`. */
export function ballSpeedForWave(wave: number): number {
  return Math.min(
    BALL_SPEED_BASE + BALL_SPEED_PER_WAVE * (wave - 1),
    BALL_SPEED_CAP,
  );
}

// --- The rings (specs/rings.md, radii from specs/field.md) ---

/** The structural gap at each side of a slot, in degrees. */
export const SLOT_GAP_DEG = STRUCTURAL_GAP_DEG;

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
export const RINGS: readonly RingSpec[] = RING_TABLE.map((row) => ({
  slots: row.slots,
  slotWidthDeg: row.slotWidthDeg,
  arcDeg: row.targetArcDeg,
  hitPoints: row.hitPoints,
  innerRadius: row.innerRadius,
  outerRadius: row.outerRadius,
  innerContactRadius: row.innerContactRadius,
  outerContactRadius: row.outerContactRadius,
  midRadius: row.midRadius,
  destroyScore: row.destroyScore,
  speedForWave: (wave) =>
    row.orbitSign *
    Math.min(
      row.orbitBaseDegPerSec + row.orbitPerWaveDegPerSec * (wave - 1),
      row.orbitCapDegPerSec,
    ),
}));

// --- Salvage pods and effects (specs/pods.md) ---

export { POD_KINDS } from "./constants";

/**
 * The kind a uniform draw `u` in `[0, 1)` lands on: the rows of
 * `POD_KIND_TABLE` laid end to end by probability, so each kind takes its
 * share of the unit interval.
 */
export function podKindForRoll(u: number): PodKind {
  let upTo = 0;
  for (const row of POD_KIND_TABLE) {
    upTo += row.probability;
    if (u < upTo) return row.kind;
  }
  return POD_KIND_TABLE[POD_KIND_TABLE.length - 1].kind;
}

/** The whole-tick duration of `widen`. */
export const WIDEN_TICKS = WIDEN_DURATION_TICKS;
/** The whole-tick duration of `narrow`. */
export const NARROW_TICKS = NARROW_DURATION_TICKS;
/** The whole-tick duration of `pierce`. */
export const PIERCE_EFFECT_TICKS = PIERCE_DURATION_TICKS;
/** How far off the outward radial each multiball ball heads, in degrees. */
export const MULTIBALL_SPLIT_DEG = MULTIBALL_OFFSET_DEG;

// --- Scoring and lives (specs/scoring.md) ---

/** A hit that leaves the target alive. */
export const SCORE_HIT = HIT_SCORE;
/** Catching a salvage pod. */
export const SCORE_POD_CATCH = POD_CATCH_SCORE;
/** The clearing event on wave `w` awards `500 * w`. */
export const WAVE_BONUS_PER_WAVE = WAVE_CLEAR_BONUS_PER_WAVE;

// --- Screens (specs/screens.md) ---

export { SCREENS } from "./constants";

/** The screen the game is on. */
export type ScreenName = Screen;

/** How many ticks the wave-clear interstitial runs. */
export const INTERSTITIAL_TICKS = WAVECLEAR_TICKS;
/** The title screen's menu copy, indexed from `0` at the top. */
export const TITLE_MENU = TITLE_ITEMS;
/** The pause screen's menu copy, indexed from `0` at the top. */
export const PAUSE_MENU = PAUSE_ITEMS;
/** The game's title, as the title screen shows it. */
export const GAME_TITLE = TITLE_TEXT;
/** The game-over screen's heading. */
export const GAME_OVER_HEADING = GAMEOVER_TEXT;

// --- Controls (specs/controls.md) ---

export { ACTIONS } from "./constants";

/** One registered action. */
export type Action = ActionName;

/** The keys that fire each action, named by `KeyboardEvent.code`. */
export const BINDINGS = ACTION_BINDINGS;

/**
 * The actions each screen answers (`specs/controls.md` "What each screen
 * reads"). An action a row omits does nothing on that screen, and `update`
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

// --- Audio and effects (specs/assets.md) ---

/** One cue name, as the engine's cue bus knows it. */
export type Cue = CueName;

/** One produced particle system, named for its file. */
export type ParticleSystem = keyof typeof PARTICLE_PATHS;

/** How many frames the produced ball spin sheet holds. */
export const BALL_FRAME_COUNT = BALL_SPIN_FRAMES;

// The stage is square by specification; the polar mapping depends on it.
if (STAGE_W !== STAGE_H) {
  throw new Error("Kessler: the logical stage must be square");
}
