// Shatter — every figure the specification fixes, restated on the validator's
// side. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS. Under an engine the case seeds the build a
// `src/constants.ts` carrying the same figures, and a check could import that
// module instead of this one. A check that does grades nothing: the comparison
// becomes "does the build do what the build says it does", which holds for every
// build, including one whose figure is wrong. A build that flew the ship at a
// thrust of 528 and said `SHIP_THRUST = 528` would pass every flight item it
// touched. So the figures a check asserts are the SPECIFICATION's, transcribed
// here from the `specs/` file named in each section heading, and a build that
// disagrees with one fails the item that asserts it.
//
// THE ONE FILE THAT MAY REACH FOR THE BUILD'S MODULE. This one, and only to
// re-export a value `specs/` leaves to the build — read to DRIVE the build, never
// compared against. Shatter has none: `specs/controls.md` names the layout, every
// action and every binding itself, and `specs/audio.md` names every cue, so
// nothing below is read out of `src/constants.ts` and this project imports it
// nowhere. Every other file in the project imports from here: `./constants` from
// the project root, `../constants` from a suite one directory down.
//
// TWO CONVENTIONS, BOTH FROM `specs/overview.md`. Positions, sizes and speeds are
// in the logical units of the fixed `1280 x 720` field, origin top-left, `y`
// increasing downward, and an entity's position is its CENTRE. The specs quote
// angles in DEGREES clockwise from the positive `x` axis, so straight up the
// field is `-90`; every angle the debug surface reports or takes is in RADIANS,
// so each angular figure is converted here, once, and a check compares radians
// with radians.
//
// WHAT IS NOT HERE. No colour, no font, no HUD layout figure: `specs/ui.md` and
// `specs/overview.md` leave the whole look to the build, so a check reads what
// the build drew rather than a value this file made up.
//
// THE `warhead` GROUPS ARE HERE UNCONDITIONALLY. A `base` checklist never names
// a script that reads them, so they cost a `base` run nothing; splitting them out
// would give the same figure two homes.

/** Degrees to radians, for the figures the specs quote in degrees. */
export const DEG = Math.PI / 180;

/* ---- The field and the star (specs/field.md) ------------------------------ */

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

/* ---- The simulation (specs/simulation.md) --------------------------------- */

/** Simulation ticks per second. The game advances in whole ticks, never part of one. */
export const TICK_HZ = 120;
/** One tick of game time, in seconds. */
export const TICK_DT = 1 / TICK_HZ;

/* ---- The gravity well (specs/gravity.md) ---------------------------------- */

/** The well's gravitational parameter: the acceleration is `MU / d^2`. */
export const MU = 4_500_000;
/** The softening radius: inside it the pull is capped at `MU / SOFTEN^2`. */
export const SOFTEN = 90;

/* ---- The ship (specs/ship.md, specs/progression.md) ----------------------- */

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
/** The facing a life begins on: straight up the field, in radians. */
export const FACE_UP = -90 * DEG;

/** The seconds of respawn grace a fresh ship carries. */
export const INVULN_TIME = 2.5;

/* ---- The gun (specs/weapons.md) ------------------------------------------- */

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

/* ---- The rocks (specs/rocks.md) ------------------------------------------- */

/** The three sizes a rock comes in. */
export type RockSize = "large" | "medium" | "small";

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

/** The kick each fragment of a gun-destroyed rock takes, across the shot's travel. */
export const SPLIT_KICK = 90;

/* ---- Armor (specs/rocks.md, `warhead` only) ------------------------------- */

/** The hits each size takes from the gun before it is destroyed. */
export const ROCK_HEALTH: Readonly<Record<RockSize, number>> = {
  large: 3,
  medium: 2,
  small: 1,
};

/** The seconds of bright flash a non-destroying hit leaves on a rock. */
export const HIT_FLASH_TIME = 0.1;

/* ---- The torpedo (specs/weapons.md, `warhead` only) ----------------------- */

/** A torpedo's collision radius. */
export const TORPEDO_R = 6;
/** The speed a torpedo holds, turning or not. */
export const TORPEDO_SPEED = 420;
/** The rate a torpedo turns onto a target at, in radians per second. */
export const TORPEDO_TURN = 160 * DEG;
/** The half-angle of the forward acquisition cone, in radians; the cone spans twice this. */
export const TORPEDO_CONE = 15 * DEG;
/** The seconds a torpedo lives before it is removed. */
export const TORPEDO_LIFE = 3.5;
/** The seconds a spent charge takes to rise linearly from `0` back to `1`. */
export const TORPEDO_RECHARGE = 10;
/** The kick each fragment of a torpedo-destroyed rock takes, radially outward. */
export const TORPEDO_SCATTER = 240;

/* ---- The saucer (specs/saucer.md) ----------------------------------------- */

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

/* ---- The waves (specs/progression.md) ------------------------------------- */

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

/* ---- The run and the score (specs/progression.md, specs/scoring.md) ------- */

/** The ships a new game begins with, counting the one being flown. */
export const START_LIVES = 3;
/** One extra ship is granted each time the score crosses a multiple of this. */
export const EXTRA_LIFE_STEP = 10_000;

/** Destroying a Large. */
export const SCORE_LARGE = 20;
/** Destroying a Medium. */
export const SCORE_MEDIUM = 50;
/** Destroying a Small. */
export const SCORE_SMALL = 100;
/** Destroying the saucer. */
export const SCORE_SAUCER = 200;

/* ---- The screens and their copy (specs/ui.md) ----------------------------- */

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

/* ---- The input actions (specs/controls.md) -------------------------------- */

/**
 * The touch layout the game registers.
 *
 * `specs/controls.md` names it outright — "the layout `LAYOUT`
 * (`dpad-4-two-buttons`), which carries four-way movement and two buttons" — so
 * it is the specification's figure rather than the build's choice, and the
 * harness builds its engine on it.
 */
export const LAYOUT = "dpad-4-two-buttons";

/**
 * Every action the game registers, in the order `specs/controls.md`'s action
 * table lists them: the layout's four movement actions, its two buttons, then the
 * menu vocabulary. "The whole of `ACTIONS` is registered."
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

/** One of {@link ACTIONS}. */
export type ActionName = (typeof ACTIONS)[number];

/** What a binding carries: the physical keys, by `KeyboardEvent.code`. */
export interface Binding {
  readonly keys: readonly string[];
}

/**
 * The keys `specs/controls.md`'s binding table gives each action, by
 * `KeyboardEvent.code` so a binding is a physical key rather than a
 * layout-dependent character.
 *
 * `Escape` deliberately drives TWO actions, `back` and `pause`, and the screen
 * decides which applies; `Space` likewise drives `a` and `confirm`.
 *
 * `b` IS THE ONE ROW THE TWO VARIANTS DIFFER ON, and the `warhead` key stands
 * here for the same reason the `warhead` figures above stand unconditionally: it
 * is the only one a script drives. `specs/controls.md` binds `b` to `KeyF` under
 * `warhead`, where it launches the torpedo and every `torpedo` script presses it,
 * and to `Space` under `base`, where it is a second way to fire a gun that `a`
 * already fires and that no check presses. The one place the whole table is read
 * rather than indexed — the how-to screen's word list — skips this row and takes
 * the torpedo's word from the build's own torpedo roster instead, so a `base`
 * build is never asked to name a key it was never given.
 */
export const BINDINGS: Readonly<Record<ActionName, Binding>> = {
  up: { keys: ["ArrowUp", "KeyW"] },
  down: { keys: ["ArrowDown", "KeyS"] },
  left: { keys: ["ArrowLeft", "KeyA"] },
  right: { keys: ["ArrowRight", "KeyD"] },
  a: { keys: ["Space"] },
  b: { keys: ["KeyF"] },
  confirm: { keys: ["Enter", "Space"] },
  back: { keys: ["Escape"] },
  pause: { keys: ["KeyP", "Escape"] },
  mute: { keys: ["KeyM"] },
};

/** The action {@link BINDINGS} states under `warhead` rather than under `base`. */
export const VARIANT_ACTION: ActionName = "b";

/* ---- The audio cues (specs/audio.md) -------------------------------------- */

/**
 * The six cue names, one per event, exactly as `specs/audio.md`'s cue table
 * fixes them — "define and play exactly the six cues in `CUES`, under exactly
 * these names".
 */
export const CUES = {
  fire: "fire",
  shatter: "shatter",
  thrust: "thrust",
  saucer: "saucer",
  death: "death",
  extraLife: "extra-life",
} as const;

/* ---- The debug surface (specs/instrumentation.md) ------------------------- */

/** The seed `reset()` uses when its caller names none. */
export const DEFAULT_SEED = 1;
