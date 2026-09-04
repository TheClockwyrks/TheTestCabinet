// Kessler — every figure the checks assert with, stated FROM THE SPECS.
// CASE-PROVIDED.
//
// This file restates the figures the rendered specification fixes, each beside
// the file that fixes it, and imports nothing: not the build's `src/game.ts`,
// and not the seeded `src/constants.ts` either. A validator's assertions trace
// to the specification alone, so the numbers it compares against are declared
// here from the spec text — a build (or a seeded file) that drifted from the
// specification must FAIL the checks, not recalibrate them.
//
// Formulas the specs state as arithmetic (the wave ball speed, the two orbit
// speed ramps) are declared as functions of the wave, spelled exactly as the
// spec spells them.

/* ------------------------------- The tick --------------------------------- */
// specs/overview.md: "The simulation advances in whole ticks, 60 per second,
// each worth 1 / 60 seconds of game time."

export const TICK_HZ = 60;
export const TICK_DT = 1 / 60;

/* ------------------------------- The stage -------------------------------- */
// specs/overview.md: "a fixed square stage of 1000 x 1000", center (500, 500).

export const STAGE_W = 1000;
export const STAGE_H = 1000;
export const STAGE_CX = 500;
export const STAGE_CY = 500;

/* ---------------------------- Field geometry ------------------------------ */
// specs/field.md, the Geometry table. Every radius is measured from the stage
// center to the CENTER of the ball or pod concerned.

/** Planet disc radius. */
export const PLANET_RADIUS = 70;
/** Ball or pod center at this radius or less burns up. */
export const BURNUP_RADIUS = 78;
/** The shield ring is drawn at this radius while active. */
export const SHIELD_RADIUS = 92;
/** Ball contact radius of the shield, crossed inward. */
export const SHIELD_CONTACT_RADIUS = 100;
/** The deflector track annulus. */
export const DEFLECTOR_TRACK_INNER = 170;
export const DEFLECTOR_TRACK_OUTER = 186;
/**
 * Deflector ball contact radius, crossed inward within the span. A parked ball
 * also sits at this radius, at the deflector's center angle.
 */
export const DEFLECTOR_BALL_CONTACT_RADIUS = 194;
/** Deflector pod catch radius, crossed inward within the span. */
export const DEFLECTOR_POD_CATCH_RADIUS = 196;
/** The deflector's baseline span, 24 degrees to each side of its center. */
export const DEFLECTOR_BASE_SPAN_DEG = 48;
/** The containment field circle. */
export const FIELD_RADIUS = 480;
/** Ball contact radius of the containment field, crossed outward. */
export const FIELD_CONTACT_RADIUS = 472;
/** Ball radius (16 across). */
export const BALL_RADIUS = 8;
/** Pod radius (20 across). */
export const POD_RADIUS = 10;

/* --------------------------- The deflector -------------------------------- */
// specs/deflector-and-ball.md.

/** "A session starts the deflector at center angle 90." */
export const DEFLECTOR_START_ANGLE_DEG = 90;
/** Held rotation moves the center angle at 270 degrees per second. */
export const DEFLECTOR_TURN_DEG_PER_SEC = 270;
/** English: rotate the specular reflection by `1.2 * offset` degrees. */
export const ENGLISH_DEG_PER_OFFSET_DEG = 1.2;
/** Clamp the outgoing direction to within 60 degrees of the outward radial. */
export const BOUNCE_CLAMP_DEG = 60;

/* ------------------------------ The ball ---------------------------------- */
// specs/deflector-and-ball.md.

/** "The ball speed of wave w is 240 + 30 * (w - 1) ... capped at 480." */
export const BALL_SPEED_BASE = 240;
export const BALL_SPEED_PER_WAVE = 30;
export const BALL_SPEED_CAP = 480;
/** "At most 6 balls are in play at once, the parked ball included." */
export const BALL_CAP = 6;
/** Ring kick: add `0.5 * u` of the ring's surface velocity. */
export const RING_KICK_FACTOR = 0.5;
/** Orbital decay: rotate toward the radial by `min(6, |phi|)` degrees. */
export const ORBITAL_DECAY_DEG = 6;

/** The ball speed the wave-`w` figures serve, launch, and bounce at. */
export function ballSpeedAtWave(w: number): number {
  return Math.min(
    BALL_SPEED_BASE + BALL_SPEED_PER_WAVE * (w - 1),
    BALL_SPEED_CAP,
  );
}

/* ------------------------------ The rings --------------------------------- */
// specs/rings.md (slots, arcs, hit points, orbit speeds) and specs/field.md
// (the annuli and contact radii). Entry 0 is ring 1, the innermost, matching
// the snapshot's `rings` order.

export interface RingSpec {
  /** Slot count. */
  slots: number;
  /** Slot width in degrees. */
  slotWidthDeg: number;
  /** Target arc width in degrees. */
  arcWidthDeg: number;
  /** Full hit points of a target on this ring. */
  hitPoints: number;
  /** The annulus, from specs/field.md. */
  innerRadius: number;
  outerRadius: number;
  /** The contact radii a ball's face crossings are decided against. */
  contactInner: number;
  contactOuter: number;
  /** The mid radius a shed pod spawns at (specs/pods.md). */
  podSpawnRadius: number;
  /** Points for destroying a target of this ring (specs/scoring.md). */
  destroyScore: number;
}

export const RINGS: readonly RingSpec[] = [
  {
    slots: 12,
    slotWidthDeg: 30,
    arcWidthDeg: 26,
    hitPoints: 1,
    innerRadius: 290,
    outerRadius: 314,
    contactInner: 282,
    contactOuter: 322,
    podSpawnRadius: 302,
    destroyScore: 100,
  },
  {
    slots: 16,
    slotWidthDeg: 22.5,
    arcWidthDeg: 18.5,
    hitPoints: 2,
    innerRadius: 360,
    outerRadius: 384,
    contactInner: 352,
    contactOuter: 392,
    podSpawnRadius: 372,
    destroyScore: 200,
  },
  {
    slots: 20,
    slotWidthDeg: 18,
    arcWidthDeg: 14,
    hitPoints: 1,
    innerRadius: 430,
    outerRadius: 454,
    contactInner: 422,
    contactOuter: 462,
    podSpawnRadius: 442,
    destroyScore: 300,
  },
] as const;

/** "The slot's target arc begins 2 degrees into the slot." */
export const STRUCTURAL_GAP_DEG = 2;

/**
 * The orbit speed of ring `ring` (1 to 3) at wave `w`, signed as
 * specs/rings.md signs it: ring 1 `0`, ring 2 `+min(12 + 3 * (w - 1), 45)`,
 * ring 3 `-min(8 + 2 * (w - 1), 30)` degrees per second.
 */
export function ringSpeedAtWave(ring: number, w: number): number {
  if (ring === 1) return 0;
  if (ring === 2) return Math.min(12 + 3 * (w - 1), 45);
  if (ring === 3) return -Math.min(8 + 2 * (w - 1), 30);
  throw new Error(`no ring ${ring}`);
}

/* ------------------------------- The pods --------------------------------- */
// specs/pods.md.

/** A destruction sheds a pod at `u1 < 0.25`. */
export const POD_DROP_CHANCE = 0.25;
/** The five kinds, with the `[from, to)` band of `u2` that draws each. */
export const POD_KIND_TABLE = [
  { kind: "widen", from: 0, to: 0.25 },
  { kind: "multiball", from: 0.25, to: 0.45 },
  { kind: "shield", from: 0.45, to: 0.65 },
  { kind: "pierce", from: 0.65, to: 0.8 },
  { kind: "narrow", from: 0.8, to: 1 },
] as const;
/** A pod falls radially inward at 120 units per second. */
export const POD_FALL_SPEED = 120;
/** `widen` sets the span to 72 degrees. */
export const WIDEN_SPAN_DEG = 72;
/** `narrow` sets the span to 30 degrees. */
export const NARROW_SPAN_DEG = 30;
/** Durations, in whole ticks. */
export const WIDEN_DURATION_TICKS = 600;
export const NARROW_DURATION_TICKS = 600;
export const PIERCE_DURATION_TICKS = 360;
/** `multiball` launches up to two balls, 20 degrees off the outward radial. */
export const MULTIBALL_LAUNCH_COUNT = 2;
export const MULTIBALL_OFFSET_DEG = 20;

/* ------------------------------- Scoring ---------------------------------- */
// specs/scoring.md, the awards table.

/** A hit that leaves the target alive. */
export const HIT_SCORE = 50;
/** Destroying a target awards its ring's figure: RINGS[i].destroyScore. */
export const DESTROY_SCORES = [100, 200, 300] as const;
/** Catching a salvage pod. */
export const POD_CATCH_SCORE = 25;
/** The clearing event on wave `w` awards `500 * w`. */
export const WAVE_CLEAR_BONUS_PER_WAVE = 500;

/* ---------------------------- Session figures ------------------------------ */

/** specs/instrumentation.md: reset restores "3 lives, wave 1". */
export const START_LIVES = 3;
export const START_WAVE = 1;
/** specs/screens.md: the waveclear banner runs 180 ticks. */
export const WAVECLEAR_TICKS = 180;
/** specs/pods.md, specs/instrumentation.md: the default pod-draw seed. */
export const DEFAULT_SEED = 1;

/* ------------------------------- Screens ---------------------------------- */
// specs/screens.md.

export const TITLE_TEXT = "KESSLER";
export const TITLE_ITEMS: readonly string[] = ["START", "HOW TO PLAY"];
export const PAUSE_ITEMS: readonly string[] = ["RESUME", "QUIT"];
export const GAMEOVER_TEXT = "GAME OVER";

/* ------------------------------- Controls --------------------------------- */
// specs/controls.md: the actions and the `KeyboardEvent.code` keys bound to
// each. A check drives REAL key events, so what it names is a code.

export const KEYS = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  confirm: ["Space", "Enter"],
  launch: ["Space"],
  back: ["Escape"],
  pause: ["KeyP"],
} as const;

/* -------------------------------- Audio ----------------------------------- */
// specs/assets.md: the thirteen cues and the two beds, by name and file.

export const CUE_NAMES = [
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

export type CueName = (typeof CUE_NAMES)[number];

/** The bed looping on `title` and `howto`, and the one on the play screens. */
export const BED_TITLE = "music-title";
export const BED_PLAY = "music-play";

/** Each cue's produced file, under the engine's `assets/` root. */
export const CUE_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  [...CUE_NAMES, BED_TITLE, BED_PLAY].map((cue) => [cue, `audio/${cue}.wav`]),
);

/* ------------------------------- Sprites ---------------------------------- */
// specs/assets.md: the produced sprites, by path under `assets/`.

export const PLANET_SPRITE = "sprites/planet.png";
export const POD_SPRITES: Readonly<Record<string, string>> = {
  widen: "sprites/pods/widen.png",
  narrow: "sprites/pods/narrow.png",
  multiball: "sprites/pods/multiball.png",
  shield: "sprites/pods/shield.png",
  pierce: "sprites/pods/pierce.png",
};
export const BALL_SPRITES: readonly string[] = [0, 1, 2, 3, 4, 5].map(
  (frame) => `sprites/ball/${frame}.png`,
);
/** The least each bed runs before it loops, in seconds. */
export const MUSIC_MIN_SECONDS = 12;

/** Sprite canvas sizes, in pixels (drawn 1:1 in logical units). */
export const PLANET_SPRITE_SIZE = 160;
export const PLANET_DISC_SIZE = 140;
export const POD_SPRITE_SIZE = 24;
export const BALL_SPRITE_SIZE = 24;
/** The spin advances one frame per 5 ticks, wrapping over 6 frames. */
export const BALL_SPIN_FRAMES = 6;
export const BALL_FRAME_TICKS = 5;

/** The produced particle systems, by path under `assets/`. */
export const PARTICLE_FILES = {
  burst: "particles/burst.json",
  spark: "particles/spark.json",
  burnup: "particles/burnup.json",
} as const;
