// Volute — the figures this case's specification fixes. CASE-PROVIDED.
//
// The same numbers also reach the build from `src/constants.ts`, which is SEEDED
// into a run of this engine. They are restated here rather than imported from
// there, because what a check holds a build to is the SPECIFICATION: the build is
// told not to edit that module, and a check that read its thresholds out of the
// build's own tree would grade the build against whatever that tree happened to
// say.
//
// So this file is the validator's side of the line, and it is the ONE PLACE a
// threshold is written. A
// suite next door imports the bound it asserts from here rather than spelling a
// number of its own, so a figure appears once and every point that turns on it
// reads the same value.
//
// EVERY VALUE BELOW IS STATED BY THE SEEDED SPECIFICATION, and each carries the
// spec file and the sentence it came from. NOTHING here is read off the reference
// implementation: a validator that enshrined a value the specs leave open would
// fail a build that satisfies every stated requirement, which is worse than no
// validator at all. Where the specification leaves a choice — the palette, the
// glyphs, the layout, the fonts, the screen copy — this file holds no value,
// because there is nothing to hold.
//
// Every position and distance is in the fixed 960 x 540 logical field
// (`specs/overview.md`: origin top-left, x right, y down), every rate is per
// second, every duration is in seconds, and every angle is in degrees measured
// from `+x` and increasing toward `+y`.

/* -------------------------------------------------------------------------- */
/* The field (specs/overview.md — "The field")                                */
/* -------------------------------------------------------------------------- */

/** "The game is played on a fixed field of `960 x 540` logical units, 16:9." */
export const FIELD_W = 960;
export const FIELD_H = 540;

/* -------------------------------------------------------------------------- */
/* The clock (specs/instrumentation.md — "A render-free core")                */
/* -------------------------------------------------------------------------- */

/**
 * "A `ConstantClock` of `1000 / 60` milliseconds makes one frame exactly one
 * simulation step of `1 / 60` second, which is the step a scenario advances the
 * engine by."
 *
 * The engine owns the clock here, so the step is the scenario's choice of clock
 * rather than a rate the game holds — and the specification makes that choice,
 * which is what keeps a duration a whole number of advanced frames and lets a
 * tolerance be stated in ticks.
 */
export const TICK_HZ = 60;

/** One tick's worth of simulated time, `1 / 60` second. */
export const TICK_DT = 1 / TICK_HZ;

/** The `1000 / 60` milliseconds the scenario's `ConstantClock` supplies. */
export const TICK_MS = 1000 / TICK_HZ;

/* -------------------------------------------------------------------------- */
/* The charges (specs/overview.md — "The charges")                            */
/* -------------------------------------------------------------------------- */

/**
 * "A core carries one of five charges: `halide`, `sulfur`, `cobalt`, `garnet`,
 * and `olivine`."
 *
 * The ids are fixed; the colour and the glyph each is drawn with are the build's,
 * so no check asserts either — only that each charge draws a produced core sprite
 * of its own.
 */
export const CHARGE_IDS = [
  "halide",
  "sulfur",
  "cobalt",
  "garnet",
  "olivine",
] as const;

export type ChargeId = (typeof CHARGE_IDS)[number];

/* -------------------------------------------------------------------------- */
/* The channel (specs/channel.md — "The channel")                             */
/* -------------------------------------------------------------------------- */

/** One vertex of the channel polyline. */
export interface Point {
  x: number;
  y: number;
}

/**
 * "The channel is a polyline of twelve vertices, listed here from the inlet."
 *
 * Vertex 0 is the inlet at arc distance 0; vertex 11 is the intake at
 * `PATH_LENGTH`. The arc distances the spec's table gives are recomputed in
 * {@link CHANNEL_ARC} from these points, so the two cannot drift apart.
 */
export const CHANNEL: readonly Point[] = [
  { x: 40, y: 40 }, //  0 — the inlet, arc 0
  { x: 920, y: 40 }, //  1 — arc 880
  { x: 920, y: 500 }, //  2 — arc 1340
  { x: 120, y: 500 }, //  3 — arc 2140
  { x: 120, y: 120 }, //  4 — arc 2520
  { x: 840, y: 120 }, //  5 — arc 3240
  { x: 840, y: 420 }, //  6 — arc 3540
  { x: 220, y: 420 }, //  7 — arc 4160
  { x: 220, y: 220 }, //  8 — arc 4360
  { x: 620, y: 220 }, //  9 — arc 4760
  { x: 620, y: 320 }, // 10 — arc 4860
  { x: 480, y: 320 }, // 11 — the intake, arc 5000
];

/** "`PATH_LENGTH` (`5000`) is the channel's total arc length." */
export const PATH_LENGTH = 5000;

/** The arc distance at each vertex, walked along {@link CHANNEL}. */
export const CHANNEL_ARC: readonly number[] = (() => {
  const arcs = [0];
  for (let i = 1; i < CHANNEL.length; i += 1) {
    arcs.push(
      arcs[i - 1] +
        Math.hypot(
          CHANNEL[i].x - CHANNEL[i - 1].x,
          CHANNEL[i].y - CHANNEL[i - 1].y,
        ),
    );
  }
  return arcs;
})();

/** "Each core is drawn as a disc of `CORE_RADIUS` (`14` units)". */
export const CORE_RADIUS = 14;

/** "arc positions differ by exactly `SPACING` (`28` units)". */
export const SPACING = 28;

/** The advance rate of "Every other segment": "`180` units/s", fixed. */
export const CATCHUP_SPEED = 180;

/** "A level starts with `12` cores already on the channel". */
export const SEED_COUNT = 12;

/** "the head at `s = 308` and the tail at `s = 0`, spaced by `SPACING`." */
export const SEED_HEAD_S = 308;
export const SEED_TAIL_S = 0;

/* -------------------------------------------------------------------------- */
/* Pressure (specs/channel.md — "Pressure")                                   */
/* -------------------------------------------------------------------------- */

/** "Cores the channel carries before pressure rises (`PRESSURE_FREE`) | `24`". */
export const PRESSURE_FREE = 24;

/** "Rise per second for each core above `PRESSURE_FREE` | `0.05`". */
export const PRESSURE_RISE_PER_CORE = 0.05;

/** "Bleed per second while the channel is not over `PRESSURE_FREE` | `2.0`". */
export const PRESSURE_BLEED = 2.0;

/** "Fall for each core a removal takes off the channel | `0.8`". */
export const PRESSURE_DROP_PER_CORE = 0.8;

/** "`pressure` is a real number held between `0` and `100` inclusive". */
export const PRESSURE_MIN = 0;
export const PRESSURE_MAX = 100;

/* -------------------------------------------------------------------------- */
/* The injector (specs/injector.md — "Figures")                               */
/* -------------------------------------------------------------------------- */

/** "Injector center | `(420, 330)`, fixed for the whole run". */
export const INJECTOR: Point = { x: 420, y: 330 };

/** "Injector radius | 22 units". */
export const INJECTOR_RADIUS = 22;

/** "Opening aim | 270 degrees" — straight up the field. */
export const OPENING_AIM = 270;

/** "`FIRE_COOLDOWN` | 0.18 s". */
export const FIRE_COOLDOWN = 0.18;

/** "`PROJECTILE_SPEED` | 620 units/s". */
export const PROJECTILE_SPEED = 620;

/** "Projectile radius | 14 units". */
export const PROJECTILE_RADIUS = 14;

/** "Strike distance | 28 units". */
export const STRIKE_DISTANCE = 28;

/**
 * "A held turn action then turns the aim by 180 degrees for every second of
 * simulation time the update advances" (specs/controls.md — "Aiming").
 */
export const AIM_RATE = 180;

/* -------------------------------------------------------------------------- */
/* Extraction (specs/extraction.md — "Figures")                               */
/* -------------------------------------------------------------------------- */

/** "Minimum extracted run | 3 cores". */
export const MIN_RUN = 3;

/** "Score for an extraction | `10 x n x k`" — the 10 of that formula. */
export const SCORE_PER_CORE = 10;

/** "`RECOIL` | 42 units". */
export const RECOIL = 42;

/** "`RECOIL_HOLD` | 0.4 s". */
export const RECOIL_HOLD = 0.4;

/** "`CHAIN_RESET` | 2.0 s". */
export const CHAIN_RESET = 2.0;

/** An extraction of `n` cores at chain step `k` "adds `10 x n x k` to the score". */
export function extractionScore(cores: number, chainStep: number): number {
  return SCORE_PER_CORE * cores * chainStep;
}

/* -------------------------------------------------------------------------- */
/* Machinery (specs/machinery.md)                                             */
/* -------------------------------------------------------------------------- */

/** The four kinds, as the marks and the active machinery name them. */
export const MACHINERY_KINDS = [
  "choke",
  "backflow",
  "bore",
  "sightline",
] as const;

export type MachineryKind = (typeof MACHINERY_KINDS)[number];

/** "Every `MARK_INTERVAL` (12) cores in that count ... one core carries a mark." */
export const MARK_INTERVAL = 12;

/**
 * "the kinds follow a fixed cycle: `choke`, `backflow`, `bore`, `sightline`,
 * then `choke` again. The first mark of a level names `choke`".
 */
export const MARK_CYCLE = [
  "choke",
  "backflow",
  "bore",
  "sightline",
] as const satisfies readonly MachineryKind[];

/** "`choke` | The feed speed is multiplied by `0.4` | `8` s". */
export const CHOKE_FACTOR = 0.4;
export const CHOKE_DURATION = 8;

/** "`backflow` | Every core moves toward the inlet at `BACKFLOW_SPEED` (`60`) units/s ... | `5` s". */
export const BACKFLOW_SPEED = 60;
export const BACKFLOW_DURATION = 5;

/** "`bore` | Every core within `BORE_RADIUS` (`90`) units ... | instant". */
export const BORE_RADIUS = 90;

/** "`sightline` | The aim ray is drawn ... | `12` s". */
export const SIGHTLINE_DURATION = 12;

/** The kinds that become the active machinery; `bore` never does. */
export const TIMED_MACHINERY = ["choke", "backflow", "sightline"] as const;

/**
 * One of the three kinds `grantMachinery` grants.
 *
 * "Grants `kind`, one of the three timed machinery kinds — `choke`, `backflow`,
 * or `sightline`" (specs/instrumentation.md). A `bore` is reached by extracting a
 * run that carries a `bore` mark, never by a pose.
 */
export type TimedMachineryKind = (typeof TIMED_MACHINERY)[number];

/** How long each timed kind runs, in seconds. */
export const MACHINERY_DURATION: Readonly<Record<MachineryKind, number>> = {
  choke: CHOKE_DURATION,
  backflow: BACKFLOW_DURATION,
  bore: 0,
  sightline: SIGHTLINE_DURATION,
};

/* -------------------------------------------------------------------------- */
/* Progression (specs/progression.md)                                         */
/* -------------------------------------------------------------------------- */

/** One row of the level table: the charges in play, the quota, the feed speed. */
export interface LevelSpec {
  level: number;
  charges: readonly ChargeId[];
  quota: number;
  feed: number;
}

/**
 * "A run plays five levels over the same channel and starts at level 1."
 *
 * | Level | Charges in play | Quota | Feed speed (units/s) |
 * | 1 | halide, sulfur, cobalt                    | 45 | 22 |
 * | 2 | halide, sulfur, cobalt, garnet            | 55 | 26 |
 * | 3 | halide, sulfur, cobalt, garnet            | 65 | 30 |
 * | 4 | halide, sulfur, cobalt, garnet, olivine   | 75 | 34 |
 * | 5 | halide, sulfur, cobalt, garnet, olivine   | 90 | 38 |
 */
export const LEVELS: readonly LevelSpec[] = [
  {
    level: 1,
    charges: ["halide", "sulfur", "cobalt"],
    quota: 45,
    feed: 22,
  },
  {
    level: 2,
    charges: ["halide", "sulfur", "cobalt", "garnet"],
    quota: 55,
    feed: 26,
  },
  {
    level: 3,
    charges: ["halide", "sulfur", "cobalt", "garnet"],
    quota: 65,
    feed: 30,
  },
  {
    level: 4,
    charges: ["halide", "sulfur", "cobalt", "garnet", "olivine"],
    quota: 75,
    feed: 34,
  },
  {
    level: 5,
    charges: ["halide", "sulfur", "cobalt", "garnet", "olivine"],
    quota: 90,
    feed: 38,
  },
];

/** "`LEVEL_COUNT` (`5`)" (specs/instrumentation.md — `startLevel`). */
export const LEVEL_COUNT = LEVELS.length;

/** The row for `level`, which is a whole number from 1 to {@link LEVEL_COUNT}. */
export function levelSpec(level: number): LevelSpec {
  const index = Math.min(Math.max(Math.round(level), 1), LEVEL_COUNT) - 1;
  return LEVELS[index];
}

/**
 * The lead segment's rate: "level feed speed x (1 + pressure / 100) x choke
 * factor" (specs/channel.md — "The effective feed speed").
 */
export function effectiveFeed(
  level: number,
  pressure: number,
  choked = false,
): number {
  return (
    levelSpec(level).feed * (1 + pressure / 100) * (choked ? CHOKE_FACTOR : 1)
  );
}

/** "A run starts with 3 cells." — `CELLS` (`3`) in specs/instrumentation.md. */
export const CELLS = 3;

/** "Every clear adds 500 to the score." */
export const CLEAR_BONUS = 500;

/** "An interlude lasts 2 s." */
export const INTERLUDE = 2;

/** "A core whose arc position `s` reaches 5000 arrives at the intake". */
export const INTAKE_S = PATH_LENGTH;

/** "The run is in danger while the head's `s` is at least 4000." */
export const DANGER_S = 4000;

/* -------------------------------------------------------------------------- */
/* Screens (specs/ui.md — "Screens")                                          */
/* -------------------------------------------------------------------------- */

export const SCREENS = [
  "title",
  "playing",
  "paused",
  "cleared",
  "setback",
  "gameover",
  "victory",
] as const;

export type ScreenName = (typeof SCREENS)[number];

/** The screens on which "Everything" or the interlude timer advances. */
export const ADVANCING_SCREENS = [
  "playing",
  "cleared",
  "setback",
] as const satisfies readonly ScreenName[];

/* -------------------------------------------------------------------------- */
/* Audio (specs/ui.md — "Audio")                                              */
/* -------------------------------------------------------------------------- */

/**
 * "Define and play exactly the fifteen cues below, under exactly these names."
 *
 * The engine's bus announces every cue by the name the build asked for it under,
 * so the harness records a name beside the tick it sounded on. The three audio
 * points read that a cue sounded and on WHICH tick, which is what the review
 * items state; whether the cue heard is the right one of the fifteen is judged by
 * ear, so these are here for completeness and no check asserts a name.
 */
export const CUES = [
  "fire",
  "seat",
  "swap",
  "denied",
  "machinery",
  "extract-1",
  "extract-2",
  "extract-3",
  "extract-4",
  "extract-5",
  "intake",
  "level-clear",
  "cell-lost",
  "hall-loop",
  "danger-loop",
] as const;

/** "`hall-loop` and `danger-loop` are the two beds". */
export const HALL_BED = "hall-loop";
export const DANGER_BED = "danger-loop";

/* -------------------------------------------------------------------------- */
/* Controls (specs/controls.md — "Actions")                                   */
/* -------------------------------------------------------------------------- */

/**
 * The key each action `specs/controls.md` names is registered under.
 *
 * `KeyboardEvent.code` values, because the engine binds "keys by
 * `KeyboardEvent.code` rather than `key` values, so a binding is
 * layout-independent" — and because that is the vocabulary a check presses in.
 * A check dispatches the key at the engine's input seam and reads the game
 * moving.
 */
export const BINDINGS = {
  /** "`aim-left` | held | turns the aim counter-clockwise". */
  "aim-left": ["ArrowLeft"],
  /** "`aim-right` | held | turns the aim clockwise". */
  "aim-right": ["ArrowRight"],
  /** "`fire` | edge | fires the loaded core along the aim". */
  fire: ["Space"],
  /** "`swap` | edge | exchanges the loaded and queued cores". */
  swap: ["KeyX"],
  /** "`confirm` | edge | starts a run, and dismisses an ending". */
  confirm: ["Enter", "Space"],
  /** "`pause` | edge | pauses, and resumes"; "bound to `Escape` and to `KeyP`". */
  pause: ["Escape", "KeyP"],
  /** "`mute` | edge | toggles the audio between muted and unmuted". */
  mute: ["KeyM"],
} as const;

/** "The backtick toggles the engine's debug overlay on every screen." */
export const OVERLAY_KEY = "Backquote";

/**
 * A key no action is bound to.
 *
 * Used to arm the engine's audio: it "opens the audio context on the first
 * pointer or key event it sees", and a key with no binding is a gesture that
 * changes nothing in the game.
 */
export const UNBOUND_KEY = "KeyZ";

/* -------------------------------------------------------------------------- */
/* The debug surface (specs/instrumentation.md — "The operations")            */
/* -------------------------------------------------------------------------- */

/** "The surface carries `version` (`VOLUTE_DEBUG_VERSION`, `1`)". */
export const VOLUTE_DEBUG_VERSION = 1;

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine.
 *
 * The clock, the keyboard, the pointer and the overlay are the ENGINE's — "the
 * surface carries no operation for any of them" — so the two clock operations an
 * engineless build owes are deliberately absent, and asking for one here would
 * fail a conformant build.
 */
export const REQUIRED_OPS = [
  "reset",
  "reconcile",
  "snapshot",
  "setScreen",
  "setLevel",
  "setScore",
  "setCells",
  "setChainStep",
  "startLevel",
  "poseTrain",
  "clearTrain",
  "setLoaded",
  "setQueued",
  "setNextEmitted",
  "setAim",
  "fire",
  "setPressure",
  "setQuotaRemaining",
  "setEmission",
  "setFeed",
  "grantMachinery",
  "pause",
  "resume",
] as const;

/** Every field `snapshot()` reports, from the "Snapshot shape" block. */
export const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "score",
  "level",
  "cells",
  "quotaRemaining",
  "emitted",
  "pressure",
  "feedSpeed",
  "chainStep",
  "chainTimer",
  "interlude",
  "danger",
  "train",
  "segments",
  "injector",
  "projectiles",
  "machinery",
  "emission",
  "feed",
  "muted",
  "simTime",
  "nextEmitted",
] as const;

/** The fields of one entry of `snapshot().train`. */
export const TRAIN_FIELDS = [
  "s",
  "x",
  "y",
  "charge",
  "mark",
  "segment",
] as const;

/** The fields of one entry of `snapshot().segments`. */
export const SEGMENT_FIELDS = ["count", "hold"] as const;

/** The fields of `snapshot().injector`. */
export const INJECTOR_FIELDS = ["aim", "cooldown", "loaded", "queued"] as const;

/** The fields of one entry of `snapshot().projectiles`. */
export const PROJECTILE_FIELDS = ["x", "y", "angle", "charge"] as const;

/* -------------------------------------------------------------------------- */
/* Produced assets (specs/assets.md — "The sprites")                          */
/* -------------------------------------------------------------------------- */

/** "core, one per charge | 28 x 28" — the natural size of a core sprite. */
export const CORE_SPRITE = 28;

/** "machinery mark | 16 x 16". */
export const MARK_SPRITE = 16;

/** "HUD cell icon | 24 x 24" and "pressure icon | 24 x 24". */
export const HUD_ICON_SPRITE = 24;

/** "extraction flash | 6 | 48 x 48" — frames and canvas of the flash sheet. */
export const FLASH_SHEET_FRAMES = 6;
export const FLASH_SHEET_SPRITE = 48;

/* -------------------------------------------------------------------------- */
/* The standing tolerances (test-case.toml — "STANDING TOLERANCES")           */
/* -------------------------------------------------------------------------- */
//
// A tick is exactly 1 / 60 s, so a count of stepped ticks converts to simulated
// seconds without rounding. Each bound below is the case's own statement of how
// far a conformant build may sit from a stated figure; a point whose own
// description states a tighter or looser one uses that instead.

/** Arc position or field distance: +/- 0.5 units. */
export const ARC_TOL = 0.5;

/** Speed, measured over at least 30 ticks: +/- 2% of the stated figure. */
export const SPEED_TOL_FRACTION = 0.02;

/** Duration or cadence: +/- 2 ticks. */
export const TICK_TOL = 2;

/** Angle: +/- 1 degree. */
export const ANGLE_TOL = 1;

/** Pressure: +/- 0.05. */
export const PRESSURE_TOL = 0.05;

/** The tolerance on a measured speed, in units/s, for a stated figure. */
export function speedTolerance(stated: number): number {
  return Math.abs(stated) * SPEED_TOL_FRACTION;
}

/* -------------------------------------------------------------------------- */
/* The tolerances a single point states for itself                            */
/* -------------------------------------------------------------------------- */
//
// "STANDING TOLERANCES, unless a point's own description states otherwise"
// (test-case.toml). These are the "otherwise": the bound a named review point
// declares in place of the standing one, gathered here so a figure is written in
// one place and the point next door reads it rather than spelling its own. Each
// names the point that states it. A point whose bound is an EXPRESSION over the
// figures above — two ticks of a rate, one tick of travel — derives it at the
// point instead, because the derivation is the justification and hiding it here
// would lose that.

/**
 * `channel/arc-position`: "compare the field point the snapshot reports for it
 * against the expected point (+/- 1 unit)".
 *
 * A field point walked from a posed arc distance is a pure function of that
 * distance rather than an integration, so the unit is rounding slack; the nearest
 * wrong leg of the polyline is more than a hundred units away.
 */
export const CHANNEL_POINT_TOL = 1;

/**
 * `channel/catchup-advance`: "step 30 ticks, and confirm the trailing core
 * stands at 1090 (+/- 1)".
 *
 * Tighter than the standing speed tolerance, which the point is entitled to: a
 * catch-up of `CATCHUP_SPEED x dt` a tick is exact arithmetic on a fixed rate,
 * and the nearest wrong rate (a lead segment's feed) is 79 units away.
 */
export const CATCHUP_ARC_TOL = 1;

/**
 * `pressure/extraction-drop`: "confirm pressure fell by 2.4 net of that tick's
 * rise or bleed (+/- 0.1)".
 *
 * Three ticks of the 2.0/s bleed, so where in its tick a build applies the bleed
 * cannot decide the point, while a flat per-removal drop misses by 1.6.
 */
export const PRESSURE_DROP_TOL = 0.1;

/**
 * `pressure/feed-multiplier`: "confirm it gained 33 units of arc (+/- 0.7)".
 *
 * The band the point states. Its CENTRE is re-derived from the spec at the point
 * rather than taken as the 33 the comment rounds to — a lone core is under
 * `PRESSURE_FREE`, so specs/channel.md bleeds the posed pressure away while the
 * measurement runs and the spec-exact gain is a little under 33.
 */
export const FEED_MULTIPLIER_TOL = 0.7;

/**
 * `extraction/recoil-distance` ("the tail fell by 69.63 (+/- 0.2)") and
 * `extraction/recoil-hold` ("the recoiled tail's arc distance is unchanged
 * (+/- 0.2)").
 *
 * Tighter than the standing arc tolerance, which both points are entitled to:
 * every term is exact arithmetic on posed values over a tick order
 * specs/channel.md fixes, not an integration.
 */
export const RECOIL_TOL = 0.2;

/**
 * `injector/aim-rotate-left` and `injector/aim-rotate-right`: "confirm the
 * reported aim is 90 degrees (+/- 2)".
 *
 * 1.1% of the 180 degrees/s the turn runs at, and under one tick's own 3-degree
 * step, so a build turning at any other rate fails.
 */
export const TURN_TOL = 2;

/**
 * `injector/projectile-speed`: "confirm the projectile stands 310 units from
 * (420, 330) (+/- 3)".
 *
 * Under a third of one tick's 10.3-unit step, and inside the standing 2% of the
 * stated 620 units/s (6.2 units over the same span).
 */
export const PROJECTILE_TRAVEL_TOL = 3;

/**
 * `machinery/sightline-ray`: "the span ends at the core's near edge, 14 units
 * short of its center (+/- 3)".
 *
 * A drawn line has a width and a cap and a rim is anti-aliased, so the end of a
 * span is legible to a few pixels and no better. Against the 14 units to the
 * core's centre and the 134 to the field edge, three units decides the point.
 */
export const RAY_END_TOL = 3;

/**
 * `screens/pause-freezes`: "confirm the head's arc distance is unchanged
 * (+/- 0.2)".
 *
 * The spec figure is exactly zero, so the only question is the honest span
 * around it. One leaked tick at level 1's feed is 22/60 = 0.367 units, so this
 * sits BELOW one tick and admits no leak at all — where the standing arc
 * tolerance of 0.5 would swallow one whole.
 */
export const PAUSE_DRIFT_TOL = 0.2;

/**
 * How far a produced sprite's drawn centre may stand from the point it is drawn
 * at, in units: half a core sprite.
 *
 * specs/channel.md centres a core's disc on the point its arc position walks to
 * and specs/assets.md fills the 28 x 28 canvas with the core, so the two share a
 * centre exactly; half a sprite is framing and rounding slack. The nearest other
 * produced sprite in any of these frames is hundreds of units away, so nothing
 * else can be mistaken for the one being read.
 */
export const SPRITE_CENTRE_TOL = CORE_SPRITE / 2;
