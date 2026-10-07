// Kessler — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// The game is POLAR over a fixed square STAGE. The stage is the 1000x1000
// logical space `specs/overview.md` defines (origin top-left, x right, y down),
// which is the engine's logical design size: the engine scales and letterboxes
// it onto the canvas, so no value here is ever expressed in real pixels. A
// position is a radius in logical units from the stage center and an angle in
// degrees, mapped as `x = STAGE_CX + r * cos(theta * PI / 180)` and
// `y = STAGE_CY + r * sin(theta * PI / 180)`; `specs/field.md` fixes the angular
// conventions every rule reads angles by.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Kessler fixes no palette, no
// font, no sprite artwork, and no layout. There is not a single color or type
// face in this file, and there is not meant to be one. `specs/screens.md` and
// `specs/assets.md` state what a player has to be able to read at a glance; how
// the field looks is the build's to design.
//
// Every rate here is PER SECOND, in logical units or degrees, and every
// gameplay duration is a whole count of TICKS of the fixed timestep below.
// `specs/overview.md` states how a frame's delta time is consumed into ticks.

// ---- The tick (specs/overview.md) ----------------------------------------

/** Ticks per second of game time. */
export const TICK_HZ = 60;

/** One tick, in seconds. The simulation advances only in whole ticks. */
export const TICK_DT = 1 / 60;

// ---- Stage (specs/overview.md) -------------------------------------------

/** The logical design size. */
export const STAGE_W = 1000;
export const STAGE_H = 1000;

/** The stage center, where the planet sits. Every radius is measured from it. */
export const STAGE_CX = 500;
export const STAGE_CY = 500;

// ---- Field geometry and contact radii (specs/field.md) -------------------
//
// Every radius is measured from the stage center to the CENTER of the ball or
// pod concerned, and every contact is a crossing event over its contact radius.

/** The planet's disc. */
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
 * The deflector's one ball contact, crossed inward within the span. A parked
 * ball also sits at this radius, at the deflector's center angle.
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

// ---- The deflector (specs/deflector-and-ball.md) -------------------------

/** The center angle a session starts the deflector at, in degrees. */
export const DEFLECTOR_START_ANGLE_DEG = 90;

/** How fast a held rotation action moves the center angle, in degrees/second. */
export const DEFLECTOR_TURN_DEG_PER_SEC = 270;

// ---- The deflector bounce (specs/deflector-and-ball.md) ------------------

/**
 * English: after the specular step the velocity is rotated by this many degrees
 * per degree of the ball's signed angular offset from the deflector's center.
 */
export const ENGLISH_DEG_PER_OFFSET_DEG = 1.2;

/**
 * Clamp: the outgoing direction's signed angle from the outward radial is
 * clamped to `[-BOUNCE_CLAMP_DEG, +BOUNCE_CLAMP_DEG]`, sign preserved.
 */
export const BOUNCE_CLAMP_DEG = 60;

// ---- Reflections off every other surface (specs/deflector-and-ball.md) ---

/**
 * Ring kick: a contact with a target in a moving ring adds this fraction of the
 * ring's surface velocity at the ball before the speed is renormalized.
 */
export const RING_KICK_FACTOR = 0.5;

/**
 * Orbital decay: every non-deflector reflection rotates the outgoing velocity
 * toward the local radial axis by `min(ORBITAL_DECAY_DEG, |phi|)` degrees.
 */
export const ORBITAL_DECAY_DEG = 6;

// ---- The ball (specs/deflector-and-ball.md) ------------------------------

/**
 * The ball speed of wave `w`, in units/second, is
 * `min(BALL_SPEED_BASE + BALL_SPEED_PER_WAVE * (w - 1), BALL_SPEED_CAP)`.
 * A launch serves at it and a deflector bounce sets the ball to it; every
 * other reflection preserves the speed the ball arrived with.
 */
export const BALL_SPEED_BASE = 240;
export const BALL_SPEED_PER_WAVE = 30;
export const BALL_SPEED_CAP = 480;

/** The most balls in play at once, the parked ball included. */
export const BALL_CAP = 6;

// ---- The rings (specs/rings.md, specs/field.md, specs/scoring.md) --------

/**
 * The structural gap at EACH side of a slot, in degrees, so a slot's target arc
 * begins this far into the slot and ends this far before the next.
 */
export const STRUCTURAL_GAP_DEG = 2;

/**
 * The three rings, ring 1 (the innermost) first — the order `snapshot().rings`
 * reports them in.
 *
 * Each ring's annulus spans `[innerRadius, outerRadius]`; a face contact
 * crosses `outerContactRadius` moving inward or `innerContactRadius` moving
 * outward, and an edge contact happens between the two. A shed pod spawns at
 * `midRadius`. The orbit speed at wave `w`, in degrees/second, is
 * `orbitSign * min(orbitBaseDegPerSec + orbitPerWaveDegPerSec * (w - 1),
 * orbitCapDegPerSec)` — positive toward `+theta` — so ring 1 is stationary at
 * every wave. `destroyScore` is what destroying one of the ring's targets
 * awards.
 */
export const RINGS = [
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
    orbitSign: 0,
    orbitBaseDegPerSec: 0,
    orbitPerWaveDegPerSec: 0,
    orbitCapDegPerSec: 0,
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
    orbitSign: 1,
    orbitBaseDegPerSec: 12,
    orbitPerWaveDegPerSec: 3,
    orbitCapDegPerSec: 45,
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
    orbitSign: -1,
    orbitBaseDegPerSec: 8,
    orbitPerWaveDegPerSec: 2,
    orbitCapDegPerSec: 30,
  },
] as const;

// ---- Salvage pods (specs/pods.md) ----------------------------------------

/** The five pod kinds, as the snapshot reports them. */
export const POD_KINDS = [
  "widen",
  "narrow",
  "multiball",
  "shield",
  "pierce",
] as const;

export type PodKind = (typeof POD_KINDS)[number];

/**
 * The pod draw. Each destruction sheds one pod with probability
 * `POD_DROP_CHANCE` and nothing otherwise; a shed pod's kind is drawn with the
 * probabilities of `POD_KIND_TABLE`, the table of `specs/pods.md` in its order.
 */
export const POD_DROP_CHANCE = 0.25;

export const POD_KIND_TABLE: readonly {
  readonly kind: PodKind;
  readonly probability: number;
}[] = [
  { kind: "widen", probability: 0.25 },
  { kind: "multiball", probability: 0.2 },
  { kind: "shield", probability: 0.2 },
  { kind: "pierce", probability: 0.15 },
  { kind: "narrow", probability: 0.2 },
];

/** How fast a pod falls radially inward, in units/second. */
export const POD_FALL_SPEED = 120;

// ---- Effects (specs/pods.md) ---------------------------------------------

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

/**
 * The multiball launch headings: this many degrees to each side of the outward
 * radial, the `+theta` ball first.
 */
export const MULTIBALL_OFFSET_DEG = 20;

// ---- Scoring, lives, and waves (specs/scoring.md, specs/rings.md) --------

/** A hit that leaves the target alive. */
export const HIT_SCORE = 50;

/** Catching a salvage pod, whatever the kind does. */
export const POD_CATCH_SCORE = 25;

/** The clearing event on wave `w` awards `WAVE_CLEAR_BONUS_PER_WAVE * w`. */
export const WAVE_CLEAR_BONUS_PER_WAVE = 500;

/** How long the `waveclear` interstitial runs, in whole ticks. */
export const WAVECLEAR_TICKS = 180;

/** A fresh session's lives, and its first wave. */
export const START_LIVES = 3;
export const START_WAVE = 1;

// ---- Screens and screen copy (specs/screens.md) --------------------------

/** Every screen the game moves between. It opens on `title`. */
export const SCREENS = [
  "title",
  "howto",
  "playing",
  "waveclear",
  "paused",
  "gameover",
] as const;

export type Screen = (typeof SCREENS)[number];

/** The title screen's heading. */
export const TITLE_TEXT = "KESSLER";

/** The title menu, entry 0 first. */
export const TITLE_ITEMS: readonly string[] = ["START", "HOW TO PLAY"];

/** The pause menu, entry 0 first. */
export const PAUSE_ITEMS: readonly string[] = ["RESUME", "QUIT"];

/** The game-over screen's heading. */
export const GAMEOVER_TEXT = "GAME OVER";

// ---- Controls (specs/controls.md) ----------------------------------------

/** Every action Kessler registers. */
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

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character. `left` and
 * `right` are read as held values; every other action is read as one press
 * edge per press.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  confirm: ["Space", "Enter"],
  launch: ["Space"],
  back: ["Escape"],
  pause: ["KeyP"],
};

// ---- Audio cues (specs/assets.md) ----------------------------------------

/** The thirteen cue names, one per event. Define and play exactly these. */
export const CUES = {
  paddleBounce: "paddle-bounce",
  fieldBounce: "field-bounce",
  targetHit: "target-hit",
  targetBreak: "target-break",
  shieldReflect: "shield-reflect",
  podCatch: "pod-catch",
  podCatchNarrow: "pod-catch-narrow",
  podBurn: "pod-burn",
  ballLost: "ball-lost",
  waveClear: "wave-clear",
  gameOver: "game-over",
  menuMove: "menu-move",
  menuSelect: "menu-select",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- The produced assets (specs/assets.md) -------------------------------
//
// Every produced file this build loads, as a path under the engine's asset root
// (`assets/`). The files themselves do not exist yet: this build produces them
// with the generation tools on the `PATH` and commits them here.

/** The produced sprites, each drawn at native size, centered on its object. */
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

/** The ball sheet: frames 0..5 in order, wrapping. */
export const BALL_SPIN_FRAMES = 6;

/**
 * How many ticks of simulation time each ball frame shows, every ball's phase
 * counted from its own spawn tick.
 */
export const BALL_FRAME_TICKS = 5;

/** The produced particle systems, played through the particle runtime. */
export const PARTICLE_PATHS = {
  burst: "particles/burst.json",
  spark: "particles/spark.json",
  burnup: "particles/burnup.json",
} as const;

/** The one cue file per cue name. */
export const CUE_PATHS: Readonly<Record<CueName, string>> = {
  "paddle-bounce": "audio/paddle-bounce.wav",
  "field-bounce": "audio/field-bounce.wav",
  "target-hit": "audio/target-hit.wav",
  "target-break": "audio/target-break.wav",
  "shield-reflect": "audio/shield-reflect.wav",
  "pod-catch": "audio/pod-catch.wav",
  "pod-catch-narrow": "audio/pod-catch-narrow.wav",
  "pod-burn": "audio/pod-burn.wav",
  "ball-lost": "audio/ball-lost.wav",
  "wave-clear": "audio/wave-clear.wav",
  "game-over": "audio/game-over.wav",
  "menu-move": "audio/menu-move.wav",
  "menu-select": "audio/menu-select.wav",
};

/**
 * The two music beds: the title bed loops on `title` and `howto`, the play bed
 * on `playing`, `waveclear`, and `paused`; `gameover` plays no bed.
 */
export const BED_PATHS = {
  title: "audio/music-title.wav",
  play: "audio/music-play.wav",
} as const;

/** The least each bed runs before looping seamlessly, in seconds. */
export const MUSIC_MIN_SECONDS = 12;

// ---- The level and the actor tags (specs/overview.md) --------------------

/**
 * The one level the whole game runs in. `src/game.ts` keys its level registry
 * and `startLevel` by this name, and the game never opens another level: every
 * screen is a value of the game state's screen field.
 */
export const LEVEL_NAME = "orbit";

/** The tag each kind of actor on the field carries. */
export const TAGS = {
  ball: "ball",
  paddle: "paddle",
  target: "target",
  pod: "pod",
} as const;

export type ActorTag = (typeof TAGS)[keyof typeof TAGS];
