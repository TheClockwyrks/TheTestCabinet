// Kessler — the figures the specification fixes, as this suite states them.
// CASE-PROVIDED.
//
// Every value here is DERIVED FROM THE RENDERED SPECS, file and statement
// named beside each group, and none is imported from the build. The seeded
// `src/constants.ts` carries the same figures for the build's own use; this
// file restates them so a check's bound traces to the specification rather
// than to anything the workspace holds, and so a build that edited its
// constants would still be graded against the spec.
//
// Every rate is PER SECOND, in logical units or degrees, and every gameplay
// duration is a whole count of TICKS of the fixed timestep.

import type { PodKind, Screen } from "./surface";

/* ---- The tick (specs/overview.md) --------------------------------------- */

/** Ticks per second of game time. */
export const TICK_HZ = 60;

/** One tick, in seconds. The simulation advances only in whole ticks. */
export const TICK_DT = 1 / 60;

/**
 * One tick, in milliseconds — the delta the harness's `ConstantClock` supplies
 * each frame, so one frame consumes exactly one tick
 * (`specs/instrumentation.md`, "What the runtime provides instead").
 */
export const TICK_MS = 1000 / 60;

/* ---- Stage (specs/overview.md) ------------------------------------------ */

/** The fixed square logical design size. */
export const STAGE_W = 1000;
export const STAGE_H = 1000;

/** The stage center, where the planet sits. Every radius is measured from it. */
export const STAGE_CX = 500;
export const STAGE_CY = 500;

/* ---- Field geometry and contact radii (specs/field.md) ------------------ */

/** The planet's disc at the stage center. */
export const PLANET_RADIUS = 70;

/** A ball or pod whose center radius reaches this or less burns up. */
export const BURNUP_RADIUS = 78;

/** The shield ring, drawn while the shield is active. */
export const SHIELD_RADIUS = 92;

/** The shield's ball contact radius, crossed inward. */
export const SHIELD_CONTACT_RADIUS = 100;

/** The annulus the deflector rides. */
export const DEFLECTOR_TRACK_INNER = 170;
export const DEFLECTOR_TRACK_OUTER = 186;

/**
 * The deflector's one ball contact radius, crossed inward within the span. A
 * parked ball also sits at this radius, at the deflector's center angle.
 */
export const DEFLECTOR_BALL_CONTACT_RADIUS = 194;

/** The deflector's pod catch radius, crossed inward within the span. */
export const DEFLECTOR_POD_CATCH_RADIUS = 196;

/** The deflector's baseline span, in degrees: half of it to each side. */
export const DEFLECTOR_BASE_SPAN_DEG = 48;

/** The containment field that encloses play. */
export const FIELD_RADIUS = 480;

/** The containment field's ball contact radius, crossed outward. */
export const FIELD_CONTACT_RADIUS = 472;

/** The ball: radius 8, so 16 across. */
export const BALL_RADIUS = 8;

/** A salvage pod: radius 10, so 20 across. */
export const POD_RADIUS = 10;

/* ---- The deflector (specs/deflector-and-ball.md) ------------------------ */

/** The center angle a session starts the deflector at, in degrees. */
export const DEFLECTOR_START_ANGLE_DEG = 90;

/** How fast a held rotation action moves the center angle, in degrees/second. */
export const DEFLECTOR_TURN_DEG_PER_SEC = 270;

/** English: degrees of rotation per degree of offset from the center. */
export const ENGLISH_DEG_PER_OFFSET_DEG = 1.2;

/** The outgoing angle from the outward radial is clamped to +/- this. */
export const BOUNCE_CLAMP_DEG = 60;

/** Ring kick: the fraction of the ring's surface velocity added at the ball. */
export const RING_KICK_FACTOR = 0.5;

/** Orbital decay: rotation toward the radial axis, `min(this, |phi|)` deg. */
export const ORBITAL_DECAY_DEG = 6;

/* ---- The ball (specs/deflector-and-ball.md) ----------------------------- */

export const BALL_SPEED_BASE = 240;
export const BALL_SPEED_PER_WAVE = 30;
export const BALL_SPEED_CAP = 480;

/** The ball speed of wave `w`: `240 + 30 * (w - 1)`, capped at `480`. */
export function ballSpeedAtWave(w: number): number {
  return Math.min(
    BALL_SPEED_BASE + BALL_SPEED_PER_WAVE * (w - 1),
    BALL_SPEED_CAP,
  );
}

/** The most balls in play at once, the parked ball included. */
export const BALL_CAP = 6;

/* ---- The rings (specs/rings.md, specs/field.md, specs/scoring.md) ------- */

/** The structural gap at EACH side of a slot, in degrees. */
export const STRUCTURAL_GAP_DEG = 2;

/** One ring's figures, as the tables of `specs/rings.md` and `specs/field.md`. */
export interface RingSpec {
  /** The annulus. */
  innerRadius: number;
  outerRadius: number;
  /** Face-contact radii: outer crossed inward, inner crossed outward. */
  innerContactRadius: number;
  outerContactRadius: number;
  /** Where a shed pod spawns (`specs/pods.md`). */
  midRadius: number;
  slots: number;
  slotWidthDeg: number;
  targetArcDeg: number;
  hitPoints: number;
  /** Destroying one of this ring's targets (`specs/scoring.md`). */
  destroyScore: number;
  /** The orbit speed at wave `w`, signed degrees per second. */
  orbitSpeedAtWave: (w: number) => number;
}

/** The three rings, ring 1 (the innermost) first — snapshot order. */
export const RING_SPECS: readonly [RingSpec, RingSpec, RingSpec] = [
  {
    innerRadius: 290,
    outerRadius: 314,
    innerContactRadius: 282,
    outerContactRadius: 322,
    midRadius: 302,
    slots: 12,
    slotWidthDeg: 30,
    targetArcDeg: 26,
    hitPoints: 1,
    destroyScore: 100,
    orbitSpeedAtWave: () => 0,
  },
  {
    innerRadius: 360,
    outerRadius: 384,
    innerContactRadius: 352,
    outerContactRadius: 392,
    midRadius: 372,
    slots: 16,
    slotWidthDeg: 22.5,
    targetArcDeg: 18.5,
    hitPoints: 2,
    destroyScore: 200,
    orbitSpeedAtWave: (w) => Math.min(12 + 3 * (w - 1), 45),
  },
  {
    innerRadius: 430,
    outerRadius: 454,
    innerContactRadius: 422,
    outerContactRadius: 462,
    midRadius: 442,
    slots: 20,
    slotWidthDeg: 18,
    targetArcDeg: 14,
    hitPoints: 1,
    destroyScore: 300,
    orbitSpeedAtWave: (w) => -Math.min(8 + 2 * (w - 1), 30),
  },
] as const;

/** Ring `ring` (1–3) of {@link RING_SPECS}. */
export function ringSpec(ring: number): RingSpec {
  return RING_SPECS[ring - 1];
}

/**
 * The wave at which both moving rings' formulas have reached the ceiling
 * `specs/rings.md` states for them: `12 + 3 * 11` is past ring 2's `45`, and
 * `8 + 2 * 11` is past ring 3's `30`.
 */
const CAPPED_WAVE = 12;

/** Ring 2's fastest orbit, the `45` its formula's `min` caps at. */
export const RING2_SPEED_CAP = ringSpec(2).orbitSpeedAtWave(CAPPED_WAVE);

/** Ring 3's fastest orbit, the `-30` its formula's `min` caps at. */
export const RING3_SPEED_CAP = ringSpec(3).orbitSpeedAtWave(CAPPED_WAVE);

/* ---- Salvage pods (specs/pods.md) --------------------------------------- */

/** The five pod kinds. */
export const POD_KINDS: readonly PodKind[] = [
  "widen",
  "narrow",
  "multiball",
  "shield",
  "pierce",
];

/** A destruction sheds a pod with probability 0.25. */
export const POD_DROP_CHANCE = 0.25;

/** The probability a shed pod is each kind, per the table `specs/pods.md` states. */
export const POD_KIND_CHANCES: Readonly<Record<PodKind, number>> = {
  widen: 0.25,
  multiball: 0.2,
  shield: 0.2,
  pierce: 0.15,
  narrow: 0.2,
};

/** How fast a pod falls radially inward, in units/second. */
export const POD_FALL_SPEED = 120;

/* ---- Effects (specs/pods.md) -------------------------------------------- */

/** The span `widen` puts in force, in degrees. */
export const WIDEN_SPAN_DEG = 72;

/** The span `narrow` puts in force, in degrees. */
export const NARROW_SPAN_DEG = 30;

/** The timed effects' durations, in whole ticks. */
export const WIDEN_DURATION_TICKS = 600;
export const NARROW_DURATION_TICKS = 600;
export const PIERCE_DURATION_TICKS = 360;

/** How many balls a `multiball` catch launches, as the cap admits. */
export const MULTIBALL_LAUNCH_COUNT = 2;

/** Multiball headings: this many degrees each side of the outward radial. */
export const MULTIBALL_OFFSET_DEG = 20;

/* ---- Scoring, lives, waves (specs/scoring.md, specs/rings.md) ----------- */

/** A hit that leaves the target alive. */
export const HIT_SCORE = 50;

/** Catching a salvage pod, whatever the kind does. */
export const POD_CATCH_SCORE = 25;

/** The clearing event on wave `w` awards `500 * w`. */
export const WAVE_CLEAR_BONUS_PER_WAVE = 500;

/** How long the `waveclear` interstitial runs, in whole ticks. */
export const WAVECLEAR_TICKS = 180;

/** A fresh session's lives, and its first wave. */
export const START_LIVES = 3;
export const START_WAVE = 1;

/* ---- Screens and screen copy (specs/screens.md) ------------------------- */

/** Every screen, in the order the spec's table lists them. */
export const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "waveclear",
  "paused",
  "gameover",
];

export const TITLE_TEXT = "KESSLER";
export const TITLE_ITEMS: readonly string[] = ["START", "HOW TO PLAY"];
export const PAUSE_ITEMS: readonly string[] = ["RESUME", "QUIT"];
export const GAMEOVER_TEXT = "GAME OVER";

/* ---- Controls (specs/controls.md) --------------------------------------- */

/** The keys bound to each action, as `KeyboardEvent.code` values. */
export const BINDINGS = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  confirm: ["Space", "Enter"],
  launch: ["Space"],
  back: ["Escape"],
  pause: ["KeyP"],
} as const;

export type ActionName = keyof typeof BINDINGS;

/* ---- Audio cues and beds (specs/assets.md) ------------------------------ */

/** The thirteen cue names, one per event. */
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

/** One produced `.wav` per cue, under the asset root. */
export const CUE_PATHS: Readonly<Record<CueName, string>> = Object.fromEntries(
  CUE_NAMES.map((name) => [name, `audio/${name}.wav`]),
) as Record<CueName, string>;

/** The two music beds: title loops on `title`/`howto`, play on the rest bar `gameover`. */
export const BED_PATHS = {
  title: "audio/music-title.wav",
  play: "audio/music-play.wav",
} as const;

/** The least each bed runs before looping seamlessly, in seconds. */
export const MUSIC_MIN_SECONDS = 12;

/**
 * The seam figures of `specs/assets.md`: the junction's half-second windows
 * must carry at least a tenth of the bed's own level, and the level across the
 * junction, read over the second either side, may move by no more than 6
 * decibels.
 */
export const MUSIC_SEAM_LEVEL_SHARE = 0.1;
export const MUSIC_SEAM_LEVEL_JUMP_DB = 6;
export const MUSIC_SEAM_WINDOW_SECONDS = 0.5;
export const MUSIC_LEVEL_WINDOW_SECONDS = 1;

/* ---- Produced sprites and particles (specs/assets.md) ------------------- */

/** The produced sprites, as paths under the asset root (`assets/`). */
export const SPRITE_PATHS = {
  planet: "sprites/planet.png",
  pods: {
    widen: "sprites/pods/widen.png",
    narrow: "sprites/pods/narrow.png",
    multiball: "sprites/pods/multiball.png",
    shield: "sprites/pods/shield.png",
    pierce: "sprites/pods/pierce.png",
  },
  ball: [
    "sprites/ball/0.png",
    "sprites/ball/1.png",
    "sprites/ball/2.png",
    "sprites/ball/3.png",
    "sprites/ball/4.png",
    "sprites/ball/5.png",
  ],
} as const;

/** The planet sprite's canvas, and the disc drawn on it, in pixels. */
export const PLANET_SPRITE_SIZE = 160;
export const PLANET_DISC_SIZE = 140;

/** The square canvas of each pod sprite and each ball frame, in pixels. */
export const POD_SPRITE_SIZE = 24;
export const BALL_SPRITE_SIZE = 24;

/** The ball sheet: frames 0..5 in order, wrapping, one frame per 5 ticks. */
export const BALL_SPIN_FRAMES = 6;
export const BALL_FRAME_TICKS = 5;

/** The produced particle systems. */
export const PARTICLE_PATHS = {
  burst: "particles/burst.json",
  spark: "particles/spark.json",
  burnup: "particles/burnup.json",
} as const;
