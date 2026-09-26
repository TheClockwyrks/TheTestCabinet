// Shatter — every figure the specification fixes, under the name it gives it.
//
// The specs name each of these and this file is where they live: nothing else in
// the build writes a bare number that a spec named. Two conventions hold
// throughout, both from `specs/overview.md`:
//
//   * Positions, sizes and speeds are in the LOGICAL units of the fixed
//     1280x720 field, origin top-left, `y` increasing downward. An entity's
//     position is its CENTRE.
//   * The specs quote angles in DEGREES, clockwise from the positive `x` axis,
//     so straight up the field is -90. Everything inside the build works in
//     radians, so each angular figure is converted here, once, and nowhere else.
//
// Rates are per second and durations are in seconds, with the two exceptions the
// specification itself states in whole simulation ticks: the gun's fire gate and
// the span of a bullet's trail.
//
// What is NOT here is the look: the palette, the type and the geometry a body is
// drawn with are this build's own and live in `src/theme.ts`. The one figure that
// sits between the two — how far out the saucer starts steering away from the
// star — is called out where it is defined.

/** Degrees to radians, for the figures the specs quote in degrees. */
export const DEG = Math.PI / 180;

/** A whole turn, in radians. */
export const TAU = Math.PI * 2;

// ---- The field and the star (specs/field.md) -----------------------------

/** The logical design width of the field. */
export const FIELD_W = 1280;
/** The logical design height of the field. */
export const FIELD_H = 720;

/** The star's centre `x`: the middle of the field, for the whole game. */
export const STAR_X = 640;
/** The star's centre `y`. */
export const STAR_Y = 360;
/** The radius of the star's solid core, the one physical boundary on the field. */
export const CORE_R = 30;
/** The radius the decorative halo fades out over. */
export const HALO_R = 120;

// ---- The gravity well (specs/gravity.md) ---------------------------------

/** The well's gravitational parameter: the acceleration is `MU / d^2`. */
export const MU = 4_500_000;
/** The softening radius: inside it the pull is capped at `MU / SOFTEN^2`. */
export const SOFTEN = 90;

// ---- The simulation (specs/simulation.md) --------------------------------

/** Simulation ticks per second. The game advances in whole ticks, never part of one. */
export const TICK_HZ = 120;
/** One tick of game time, in seconds. */
export const TICK_DT = 1 / TICK_HZ;

// ---- The ship (specs/ship.md, specs/progression.md) ----------------------

/** The ship's collision radius. */
export const SHIP_R = 14;
/** The rotation rate while a turn key is held, in radians per second. */
export const SHIP_TURN = 300 * DEG;
/** The thrust acceleration along the facing, in units per second squared. */
export const SHIP_THRUST = 480;
/** The seconds an un-thrusting ship takes to lose half its speed. */
export const SHIP_DRAG_HALFLIFE = 3.0;
/** The ship's speed cap. */
export const SHIP_MAX = 680;

/** The safe point's `x`: directly below the star and clear of its core. */
export const SAFE_X = 640;
/** The safe point's `y`. */
export const SAFE_Y = 560;
/** The facing a life begins on: straight up the field. */
export const FACE_UP = -90 * DEG;

/** The seconds of respawn grace a fresh ship carries. */
export const INVULN_TIME = 2.5;
/** The ships a new game begins with, counting the one being flown. */
export const START_LIVES = 3;
/** One extra ship is granted each time the score crosses a multiple of this. */
export const EXTRA_LIFE_STEP = 10_000;

// ---- The gun (specs/weapons.md) ------------------------------------------

/** A bullet's collision radius. */
export const BULLET_R = 3;
/** The speed a bullet leaves at, along the facing, on top of the ship's velocity. */
export const MUZZLE_SPEED = 520;
/** The seconds a bullet lives before it is removed. */
export const BULLET_LIFE = 1.5;
/** How many of the ship's bullets may be in flight at once. */
export const MAX_BULLETS = 4;
/** Whole ticks between shots. One of the two figures the specs fix in ticks. */
export const FIRE_INTERVAL_TICKS = 22;
/** The ticks of recent travel a bullet's trail spans. The other tick figure. */
export const TRAIL_TICKS = 18;

// ---- The rocks (specs/rocks.md) ------------------------------------------

/** The three sizes a rock comes in. */
export type RockSize = "large" | "medium" | "small";

/** The three sizes, largest first — the order a roster or a menu reads in. */
export const ROCK_SIZES: readonly RockSize[] = ["large", "medium", "small"];

/** Each size's collision radius, whatever it is drawn as. */
export const ROCK_RADIUS: Readonly<Record<RockSize, number>> = {
  large: 46,
  medium: 26,
  small: 14,
};

/** The bottom of each size's base drift speed range. */
export const ROCK_SPEED_MIN: Readonly<Record<RockSize, number>> = {
  large: 60,
  medium: 90,
  small: 130,
};

/** The top of each size's base drift speed range. */
export const ROCK_SPEED_MAX: Readonly<Record<RockSize, number>> = {
  large: 110,
  medium: 150,
  small: 210,
};

/** The size a destroyed rock leaves two of, or `null` where it leaves nothing. */
export const ROCK_CHILD: Readonly<Record<RockSize, RockSize | null>> = {
  large: "medium",
  medium: "small",
  small: null,
};

/** The kick each fragment of a destroyed rock takes, across the shot's travel. */
export const SPLIT_KICK = 90;

// ---- The waves (specs/progression.md) ------------------------------------

/** Wave `N` spawns `WAVE_BASE_ROCKS + N` Large rocks. */
export const WAVE_BASE_ROCKS = 3;
/** Each wave past the first adds this fraction to the base drift speed... */
export const WAVE_SPEED_STEP = 0.04;
/** ...capped here, so every wave from 11 onward drifts 40 percent faster. */
export const WAVE_SPEED_CAP = 0.4;
/** The seconds the `WAVE N` banner runs for. */
export const WAVE_BANNER_TIME = 1.5;
/** The least a spawning rock may be from the ship, by shortest wrapped distance. */
export const WAVE_MIN_SHIP_DIST = 300;
/** The least a spawning rock may be from the star's centre. */
export const WAVE_MIN_STAR_DIST = 200;

// ---- The saucer (specs/saucer.md) ----------------------------------------

/** The saucer's collision radius. */
export const SAUCER_R = 18;
/** The horizontal speed it crosses the field at. */
export const SAUCER_SPEED = 140;
/** The vertical speed each weave runs at. */
export const SAUCER_WEAVE_SPEED = 90;
/** The seconds between two rerolls of the weave. */
export const SAUCER_WEAVE_INTERVAL = 1.0;
/** The seconds between two shots. */
export const SAUCER_FIRE_INTERVAL = 1.6;
/** The bound on the aim error drawn afresh for every shot, in radians. */
export const SAUCER_AIM_ERROR = 10 * DEG;
/** The speed a saucer bullet leaves at, on top of the saucer's own velocity. */
export const SAUCER_BULLET_SPEED = 300;
/** A saucer bullet's collision radius. */
export const SAUCER_BULLET_R = 3;
/** The seconds a saucer bullet lives for. */
export const SAUCER_BULLET_LIFE = 1.4;
/** The seconds after entering that a saucer leaves the field. */
export const SAUCER_LIFETIME = 12;
/** The game time before the first saucer of a game arrives. */
export const SAUCER_FIRST_DELAY = 18;
/** The shortest gap between one saucer leaving and the next arriving. */
export const SAUCER_GAP_MIN = 25;
/** The longest such gap. */
export const SAUCER_GAP_MAX = 35;

/**
 * How far from the star the saucer starts steering away from the core.
 *
 * `specs/saucer.md` fixes only the outcome — the saucer's circle never overlaps
 * the core, so its centre is never nearer than `CORE_R + SAUCER_R` (48) — and
 * says in as many words that how far outside that it steers is the build's. This
 * figure is therefore this build's choice, not a figure the specification names,
 * and it is generous on purpose: a saucer that begins turning out this far never
 * comes close to the bound.
 */
export const SAUCER_AVOID_DIST = 118;

// ---- The score (specs/scoring.md) ----------------------------------------

/** Destroying a Large. */
export const SCORE_LARGE = 20;
/** Destroying a Medium. */
export const SCORE_MEDIUM = 50;
/** Destroying a Small. */
export const SCORE_SMALL = 100;
/** Destroying the saucer. */
export const SCORE_SAUCER = 200;

/** What each size pays on its destruction. */
export const ROCK_SCORE: Readonly<Record<RockSize, number>> = {
  large: SCORE_LARGE,
  medium: SCORE_MEDIUM,
  small: SCORE_SMALL,
};

// ---- The screens and their copy (specs/ui.md) ----------------------------

/** The five screens the game is on exactly one of. */
export type Screen = "title" | "howto" | "playing" | "paused" | "gameover";

/** The game's name, on the title screen. */
export const TITLE_TEXT = "SHATTER";
/** The line under it. */
export const TAGLINE_TEXT = "GRAVITY WELL SHOOTER";
/** The title menu's entries, in order. */
export const TITLE_ITEMS = ["PLAY", "HOW TO PLAY"] as const;
/** The pause menu's entries, in order. */
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
/** The game-over menu's entries, in order. */
export const GAMEOVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/**
 * The seconds the awarded-ship announcement stays on the field.
 *
 * `specs/scoring.md` fixes a floor of half a second and leaves the rest to the
 * build; this is comfortably over it so the award is read rather than glimpsed.
 */
export const EXTRA_LIFE_SHOW = 2.0;

// ---- The keyboard (specs/controls.md) ------------------------------------

/** Every action the game answers to. The runtime binds keys; the game reads names. */
export const ACTIONS = [
  "thrust",
  "left",
  "right",
  "fire",
  "pause",
  "confirm",
  "back",
  "mute",
  "menu-up",
  "menu-down",
] as const;

/** One of the action names above. */
export type ActionName = (typeof ACTIONS)[number];

/**
 * The `KeyboardEvent.code` values each action is driven by.
 *
 * Physical keys, so a binding survives a non-QWERTY layout. Several codes drive
 * more than one action — `Space` fires and confirms, `Escape` pauses and leaves,
 * `ArrowUp` thrusts and moves a menu selection up — and `specs/controls.md` fixes
 * that the SCREEN decides which meaning applies, which `src/game.ts` does by
 * reading only the actions that screen answers to.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  thrust: ["ArrowUp", "KeyW"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  fire: ["Space"],
  pause: ["KeyP", "Escape"],
  confirm: ["Space", "Enter"],
  back: ["Escape"],
  mute: ["KeyM"],
  "menu-up": ["ArrowUp", "KeyW"],
  "menu-down": ["ArrowDown", "KeyS"],
};

// ---- Audio (specs/audio.md) ----------------------------------------------

/** The six cues, under exactly the names the specification gives them. */
export const CUES = {
  fire: "fire",
  shatter: "shatter",
  thrust: "thrust",
  saucer: "saucer",
  death: "death",
  extraLife: "extra-life",
} as const;

/** One of the six cue names. */
export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- The debug surface (specs/instrumentation.md) ------------------------

/** The version the surface reports. */
export const SHATTER_DEBUG_VERSION = 1;
