// Kessler — the figures this case's specification fixes. CASE-PROVIDED.
//
// An engineless run seeds no `src/` at all — the build writes every module it
// has, including whichever one it chooses to name these figures in — so there
// is nothing for a check to import, and the values live on the validator's side
// of the line. Every value below is stated by the seeded specification the
// build was given, under the name that specification uses, and nothing here is
// read from a build: a check that compared a build's own constant against
// itself would grade nothing. The pairing is deliberate — `TICK_DT` here is
// `specs/overview.md`'s tick, and a build that ticks at some other rate fails
// the point rather than moving the target.
//
// Positions are in the logical units of `specs/overview.md` (a fixed square
// `STAGE x STAGE` stage, origin top-left, x right, y down) and the polar
// mapping it fixes (`r` from the stage center, `theta` in degrees, `0` along
// `+x`, increasing toward `+y`). Every rate is per second, and every gameplay
// duration is a whole count of ticks.

// ---- The stage and the polar mapping (specs/overview.md) --------------------

/** The logical stage is a fixed square, `1000 x 1000`. */
export const STAGE = 1000;
export const STAGE_W = STAGE;
export const STAGE_H = STAGE;

/** The stage center, which the planet sits on. */
export const CENTER_X = 500;
export const CENTER_Y = 500;

/** Degrees to radians, for the polar mapping's `cos`/`sin`. */
export const DEG = Math.PI / 180;

/** The stage point at radius `r`, angle `thetaDeg`, under the polar mapping. */
export function pointAt(r: number, thetaDeg: number): { x: number; y: number } {
  return {
    x: CENTER_X + r * Math.cos(thetaDeg * DEG),
    y: CENTER_Y + r * Math.sin(thetaDeg * DEG),
  };
}

/** The polar reading of a stage point: `r`, and `theta` normalized to [0, 360). */
export function polarOf(x: number, y: number): { r: number; theta: number } {
  const dx = x - CENTER_X;
  const dy = y - CENTER_Y;
  return {
    r: Math.hypot(dx, dy),
    theta: normalizeDeg(Math.atan2(dy, dx) / DEG),
  };
}

/** `deg` normalized into `[0, 360)`. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The wrap-aware angular offset from `fromDeg` to `toDeg`, in `[-180, 180)`,
 * as `specs/field.md`'s angular conventions take it.
 */
export function angularOffset(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

/**
 * Whether angle `thetaDeg` is within `halfSpanDeg` of `centerDeg` by wrap-aware
 * circular distance, boundaries inclusive — the angular membership rule of
 * `specs/field.md`.
 */
export function withinArc(
  thetaDeg: number,
  centerDeg: number,
  halfSpanDeg: number,
): boolean {
  return Math.abs(angularOffset(centerDeg, thetaDeg)) <= halfSpanDeg;
}

/**
 * The velocity of speed `speed` headed `thetaDeg` degrees from the outward
 * radial at stage angle `atThetaDeg`, positive toward `+theta`. A convenience
 * for posing `spawnBall` velocities: `outwardVelocity(240, 90, 0)` is a ball at
 * angle `90` heading straight out at `240`.
 */
export function outwardVelocity(
  speed: number,
  atThetaDeg: number,
  offDeg = 0,
): { vx: number; vy: number } {
  const heading = (atThetaDeg + offDeg) * DEG;
  return { vx: speed * Math.cos(heading), vy: speed * Math.sin(heading) };
}

// ---- The tick (specs/overview.md) -------------------------------------------

/** Ticks of simulation per second of game time. */
export const TICK_HZ = 60;
/** Seconds of game time one tick covers. */
export const TICK_DT = 1 / 60;
/** Milliseconds of game time one tick covers. */
export const TICK_MS = 1000 / 60;

// ---- The field's geometry (specs/field.md) ----------------------------------

/** The planet: a disc at the stage center. */
export const PLANET_RADIUS = 70;
/** A ball or pod whose center radius reaches this or less burns up. */
export const BURN_UP_RADIUS = 78;
/** The shield ring is drawn at this radius while active. */
export const SHIELD_RADIUS = 92;
/** A ball crossing inward over this radius reflects off an active shield. */
export const SHIELD_CONTACT_RADIUS = 100;
/** The deflector track annulus. */
export const TRACK_INNER_RADIUS = 170;
export const TRACK_OUTER_RADIUS = 186;
/** A ball crossing inward over this radius, within the span, bounces. */
export const PADDLE_CONTACT_RADIUS = 194;
/** A pod crossing inward over this radius, within the span, is caught. */
export const POD_CATCH_RADIUS = 196;
/** The deflector's baseline span, in degrees (24 to each side of center). */
export const PADDLE_SPAN_BASE = 48;
/** The containment field circle. */
export const CONTAINMENT_RADIUS = 480;
/** A ball crossing outward over this radius reflects off the containment. */
export const CONTAINMENT_CONTACT_RADIUS = 472;
/** A ball is 16 across. */
export const BALL_RADIUS = 8;
/** A pod is 20 across. */
export const POD_RADIUS = 10;

// ---- The deflector and the ball (specs/deflector-and-ball.md) ---------------

/** The deflector's center angle when a session starts. */
export const PADDLE_START_ANGLE = 90;
/** Degrees per second a held rotation key moves the deflector. */
export const PADDLE_TURN_RATE = 270;
/** A parked ball sits at this radius at the deflector's center angle. */
export const SERVE_RADIUS = PADDLE_CONTACT_RADIUS;
/** The most balls in play at once, the parked ball included. */
export const BALL_CAP = 6;
/** The ball speed of wave `w`: `240 + 30 * (w - 1)`, capped at `480`. */
export function ballSpeed(wave: number): number {
  return Math.min(240 + 30 * (wave - 1), 480);
}
/** The English step rotates by `1.2 * offset` degrees. */
export const ENGLISH_PER_OFFSET_DEG = 1.2;
/** The clamp step holds the outgoing angle from `n` to `[-60, +60]` degrees. */
export const BOUNCE_CLAMP_DEG = 60;
/** The ring kick adds `0.5 * u`, `u` the ring's surface velocity at the ball. */
export const RING_KICK_FACTOR = 0.5;
/** Orbital decay rotates toward the radial by `min(6, |phi|)` degrees. */
export const ORBITAL_DECAY_MAX_DEG = 6;

// ---- The rings (specs/rings.md) ---------------------------------------------

/** One ring's figures, as the specification's table states them. */
export interface RingSpec {
  /** Slots the ring carries. */
  slots: number;
  /** One slot's width, in degrees. */
  slotWidthDeg: number;
  /** One target's arc, in degrees, beginning 2 degrees into its slot. */
  targetArcDeg: number;
  /** A fresh target's hit points. */
  hp: number;
  /** The annulus, and the contact radii a ball crosses. */
  innerRadius: number;
  outerRadius: number;
  contactInnerRadius: number;
  contactOuterRadius: number;
  /** Where a shed pod spawns: the ring's mid radius (specs/pods.md). */
  podSpawnRadius: number;
  /** The orbit speed at wave `w`, signed, degrees per second. */
  speedAtWave(w: number): number;
}

/** Ring 1 first (the innermost). `RINGS[ring - 1]` is ring `ring`. */
export const RINGS: readonly RingSpec[] = [
  {
    slots: 12,
    slotWidthDeg: 30,
    targetArcDeg: 26,
    hp: 1,
    innerRadius: 290,
    outerRadius: 314,
    contactInnerRadius: 282,
    contactOuterRadius: 322,
    podSpawnRadius: 302,
    speedAtWave: () => 0,
  },
  {
    slots: 16,
    slotWidthDeg: 22.5,
    targetArcDeg: 18.5,
    hp: 2,
    innerRadius: 360,
    outerRadius: 384,
    contactInnerRadius: 352,
    contactOuterRadius: 392,
    podSpawnRadius: 372,
    speedAtWave: (w) => Math.min(12 + 3 * (w - 1), 45),
  },
  {
    slots: 20,
    slotWidthDeg: 18,
    targetArcDeg: 14,
    hp: 1,
    innerRadius: 430,
    outerRadius: 454,
    contactInnerRadius: 422,
    contactOuterRadius: 462,
    podSpawnRadius: 442,
    speedAtWave: (w) => -Math.min(8 + 2 * (w - 1), 30),
  },
] as const;

/**
 * The wave at which both moving rings' formulas have reached the ceiling
 * `specs/rings.md` states for them: `12 + 3 * 11` is past ring 2's `45`, and
 * `8 + 2 * 11` is past ring 3's `30`.
 */
const CAPPED_WAVE = 12;

/** Ring 2's fastest orbit, the `45` its formula's `min` caps at. */
export const RING2_SPEED_CAP = RINGS[1].speedAtWave(CAPPED_WAVE);

/** Ring 3's fastest orbit, the `-30` its formula's `min` caps at. */
export const RING3_SPEED_CAP = RINGS[2].speedAtWave(CAPPED_WAVE);

/** The structural gap at each side of a slot, in degrees. */
export const SLOT_GAP_DEG = 2;

/** Targets a full wave lays out: every slot of all three rings. */
export const TOTAL_SLOTS = RINGS.reduce((sum, ring) => sum + ring.slots, 0);

/**
 * The center angle of slot `slot`'s target arc on ring `ring` (1-based), under
 * ring angle `ringAngleDeg`. Slot `k` begins at the ring's angle plus `k` slot
 * widths, its target arc begins 2 degrees into the slot and spans the target
 * arc width, so the arc's center sits `2 + arc / 2` degrees into the slot.
 */
export function slotArcCenterDeg(
  ring: number,
  slot: number,
  ringAngleDeg = 0,
): number {
  const spec = RINGS[ring - 1];
  return normalizeDeg(
    ringAngleDeg +
      slot * spec.slotWidthDeg +
      SLOT_GAP_DEG +
      spec.targetArcDeg / 2,
  );
}

/** A ring's mid radius, where its targets (and shed pods) center. */
export function ringMidRadius(ring: number): number {
  const spec = RINGS[ring - 1];
  return (spec.innerRadius + spec.outerRadius) / 2;
}

// ---- Pods and effects (specs/pods.md) ---------------------------------------

/** The five pod kinds, in the order the draw table states them. */
export const POD_KINDS = [
  "widen",
  "multiball",
  "shield",
  "pierce",
  "narrow",
] as const;
export type PodKind = (typeof POD_KINDS)[number];

/** A destruction sheds a pod at `u1 < 0.25`. */
export const POD_DROP_CHANCE = 0.25;

/** The kind a second draw value `u2` selects, per the specification's table. */
export function podKindFor(u2: number): PodKind {
  if (u2 < 0.25) return "widen";
  if (u2 < 0.45) return "multiball";
  if (u2 < 0.65) return "shield";
  if (u2 < 0.8) return "pierce";
  return "narrow";
}

/** The seed a fresh session lays the pod generator with. */
export const DEFAULT_SEED = 1;

/**
 * The mulberry32 generator `specs/pods.md` fixes as the session's one random
 * stream: seeded once, each call the stream's next value in `[0, 1)`. Stated
 * here so a check can PREDICT the seeded pod sequence a scenario should shed,
 * rather than reading it off the build under test.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The pod each of the first `draws` destructions sheds under `seed`, in order:
 * `null` for a destruction that sheds nothing. Each destruction consumes `u1`,
 * and a shedding one consumes `u2` as well, exactly as the draw states.
 */
export function podSequence(seed: number, draws: number): (PodKind | null)[] {
  const next = mulberry32(seed);
  const shed: (PodKind | null)[] = [];
  for (let i = 0; i < draws; i += 1) {
    const u1 = next();
    shed.push(u1 < POD_DROP_CHANCE ? podKindFor(next()) : null);
  }
  return shed;
}

/** A pod falls radially inward at this speed, its center angle constant. */
export const POD_FALL_SPEED = 120;

/** The spans the two span effects put in force. */
export const WIDEN_SPAN = 72;
export const NARROW_SPAN = 30;

/** The timed effects' durations, in whole ticks. */
export const WIDEN_TICKS = 600;
export const NARROW_TICKS = 600;
export const PIERCE_TICKS = 360;

/** A multiball catch launches up to two balls, 20 degrees off the radial. */
export const MULTIBALL_OFFSET_DEG = 20;

// ---- Scoring and lives (specs/scoring.md, specs/field.md) -------------------

/** A hit that leaves the target alive. */
export const HIT_POINTS = 50;
/** Destroying a target of ring 1, 2, 3. `DESTROY_POINTS[ring - 1]`. */
export const DESTROY_POINTS: readonly number[] = [100, 200, 300];
/** Catching a salvage pod. */
export const POD_CATCH_POINTS = 25;
/** The clearing event on wave `w` awards `500 * w`. */
export function waveClearBonus(wave: number): number {
  return 500 * wave;
}
/** A fresh session's lives. */
export const START_LIVES = 3;

// ---- Screens, menus, and copy (specs/screens.md) ----------------------------

export const SCREENS = [
  "title",
  "howto",
  "playing",
  "waveclear",
  "paused",
  "gameover",
] as const;
export type Screen = (typeof SCREENS)[number];

/** The interstitial's length, in ticks. */
export const WAVECLEAR_TICKS = 180;

/** The game's title, as the title screen shows it. */
export const TITLE_COPY = "KESSLER";
/** The title menu's entries, indexed from 0 at the top. */
export const TITLE_MENU = ["START", "HOW TO PLAY"] as const;
/** The pause menu's entries. */
export const PAUSE_MENU = ["RESUME", "QUIT"] as const;
/** The game-over screen's heading. */
export const GAMEOVER_COPY = "GAME OVER";

// ---- Controls (specs/controls.md) -------------------------------------------

/** The actions and the `KeyboardEvent.code`s bound to each. */
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

/** The debug overlay's toggle (specs/instrumentation.md). */
export const OVERLAY_TOGGLE_CODE = "Backquote";

/**
 * A key bound to nothing: pressed to give the build the genuine browser
 * gesture its audio needs, without changing any game state.
 */
export const UNBOUND_KEY = "KeyX";

// ---- The produced assets (specs/assets.md) ----------------------------------

/**
 * The thirteen cues, each named by its produced file's basename — which is how
 * the injected audio probe names a sound (the bundler's content hash stripped).
 */
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

/** The two music beds, and the screens each loops on. */
export const MUSIC_TITLE = "music-title";
export const MUSIC_PLAY = "music-play";

/** The least each bed runs before it loops, in seconds. */
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

/** The ball sheet: six frames, advancing one frame per 5 ticks, wrapping. */
export const BALL_SHEET_FRAMES = 6;
export const BALL_SPIN_TICKS_PER_FRAME = 5;

/** The sprite canvas sizes, in pixels (one logical unit each at draw time). */
export const PLANET_SPRITE_SIZE = 160;
/** The planet's disc, across, on that canvas. */
export const PLANET_DISC_SIZE = 140;
export const POD_SPRITE_SIZE = 24;
export const BALL_SPRITE_SIZE = 24;
