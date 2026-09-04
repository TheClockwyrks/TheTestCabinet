// Shatter — every figure the specification fixes, restated on the validator's
// side. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS AT ALL, AND WHY IT IS ONLY HERE. Under `simple-2d` and
// `structured-2d` the case seeds `src/constants.ts` into the workspace, so a
// validator imports the same module the build was told to build against and the
// two cannot drift. An engineless run seeds no `src/` whatever: there is nothing
// to import, and every figure below would otherwise have to be spelled out inside
// whichever check happened to need it.
//
// NOTHING HERE IS READ FROM A BUILD, AND THAT IS THE POINT. Each figure is
// transcribed from the `specs/` file named in its section heading, which is the
// document the build was handed. A check that read a build's own idea of
// `SAUCER_SPEED` and then asserted the build travelled at it would grade nothing
// at all — it would compare a build against itself and pass whatever it holds. So
// the figures are the specification's, they are stated once, and a build that
// disagrees with one fails the item that asserts it.
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
// the build drew rather than a value this file made up. No named actions and no
// cue names either — an engineless build has neither, so what stands in their
// place is the raw `KeyboardEvent.code` table `specs/controls.md` fixes and,
// for the cues, nothing at all (`audio-init.js` explains why a cue's name is
// unobservable from outside an engineless build).
//
// THE `warhead` GROUPS ARE HERE UNCONDITIONALLY. A `base` checklist never names
// a script that reads them, so they cost a `base` run nothing; splitting them out
// would give the same figure two homes.

/** Degrees to radians, for the figures the specs quote in degrees. */
export const DEG = Math.PI / 180;

/** A whole turn, in radians. */
export const TAU = Math.PI * 2;

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
/** Nothing of the star is drawn beyond this (`1.5 x HALO_R`). */
export const STAR_DRAW_R = 1.5 * HALO_R;

/* ---- The simulation (specs/simulation.md) --------------------------------- */

/** Simulation ticks per second. The game advances in whole ticks, never part of one. */
export const TICK_HZ = 120;
/** One tick of game time, in seconds. */
export const TICK_DT = 1 / TICK_HZ;
/**
 * One tick of game time, in milliseconds.
 *
 * The harness stamps each recorded frame with this, so a replay plays back at the
 * rate the game ran at. It is a restatement of `TICK_DT`, not a second figure.
 */
export const TICK_MS = 1000 / TICK_HZ;

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
/** The same rate as the specification quotes it, in degrees per second. */
export const SHIP_TURN_DEG = 300;
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

/** The three sizes, largest first — the order a roster or a ladder reads in. */
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
/** The same rate as the specification quotes it, in degrees per second. */
export const TORPEDO_TURN_DEG = 160;
/** The half-angle of the forward acquisition cone, in radians; the cone spans twice this. */
export const TORPEDO_CONE = 15 * DEG;
/** The same half-angle in degrees. */
export const TORPEDO_CONE_DEG = 15;
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
/** The same bound in degrees. */
export const SAUCER_AIM_ERROR_DEG = 10;
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
 * The nearest the saucer's centre may come to the star's centre.
 *
 * The one distance `specs/saucer.md` fixes: the saucer's circle never overlaps the
 * core, so its centre is never nearer than `CORE_R + SAUCER_R`. How far outside
 * that a build chooses to steer is the build's, and nothing here says.
 */
export const SAUCER_CLEARANCE = CORE_R + SAUCER_R;

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

/** The speed multiplier `specs/progression.md` gives wave `n`'s rocks. */
export function waveSpeedScale(wave: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (wave - 1));
}

/** How many Large rocks wave `n` spawns. */
export function waveRockCount(wave: number): number {
  return WAVE_BASE_ROCKS + wave;
}

/* ---- The run and the score (specs/progression.md, specs/scoring.md) ------- */

/** The ships a new game begins with, counting the one being flown. */
export const START_LIVES = 3;
/** One extra ship is granted each time the score crosses a multiple of this. */
export const EXTRA_LIFE_STEP = 10_000;
/** The least time an extra ship must be announced on the field for. */
export const EXTRA_LIFE_SHOW_MIN = 0.5;

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

/* ---- The screens and their copy (specs/ui.md) ----------------------------- */

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
 * The standalone words the how-to screen names the controls with, under `base`.
 *
 * `specs/ui.md` fixes them as WORDS rather than as a sentence, which is what
 * `screens/howto-shows-the-controls` reads with {@link drewWord} rather than with
 * a substring: a screen reading "press the spacebar" contains `space` and names
 * no key the specification named.
 */
export const HOWTO_WORDS = [
  "ARROWS",
  "WASD",
  "SPACE",
  "ENTER",
  "ESC",
  "P",
  "M",
] as const;

/** The one word `warhead` adds to {@link HOWTO_WORDS}, for the torpedo key. */
export const HOWTO_WORD_TORPEDO = "F";

/* ---- The keyboard (specs/controls.md) ------------------------------------- */
//
// An engineless build has no named actions: `specs/controls.md` gives it a table
// of `KeyboardEvent.code` values to listen for directly, and this is that table.
// A `none` check drives Chromium's real keyboard through Playwright, so what it
// presses is a code from here.

/** Thrust while playing; move a menu selection up. */
export const KEYS_THRUST = ["ArrowUp", "KeyW"] as const;
/** Move a menu selection down. Bound to nothing while playing. */
export const KEYS_MENU_DOWN = ["ArrowDown", "KeyS"] as const;
/** Rotate counter-clockwise. */
export const KEYS_LEFT = ["ArrowLeft", "KeyA"] as const;
/** Rotate clockwise. */
export const KEYS_RIGHT = ["ArrowRight", "KeyD"] as const;
/** Fire the gun while playing; confirm on a menu. */
export const KEY_FIRE = "Space";
/** Confirm on a menu. `Space` confirms too; the screen decides. */
export const KEYS_CONFIRM = ["Space", "Enter"] as const;
/** Launch the torpedo (`warhead` only). */
export const KEY_TORPEDO = "KeyF";
/** Pause while playing; resume the paused game on a menu. */
export const KEY_PAUSE = "KeyP";
/** Pause while playing; leave the screen otherwise. */
export const KEY_BACK = "Escape";
/** Toggle sound, from any screen. */
export const KEY_MUTE = "KeyM";

/** Show or hide the read-only debug overlay. */
export const OVERLAY_KEY = "Backquote";

/**
 * A key `specs/controls.md` binds to nothing, under either variant.
 *
 * {@link Harness.armAudio} presses it to give the build a genuine, browser-trusted
 * gesture — `specs/audio.md` says audio does not start until the player has
 * interacted with the page — without touching a thing the game answers to.
 */
export const UNBOUND_KEY = "KeyZ";

/* ---- The debug surface (specs/instrumentation.md) ------------------------- */

/** The version the surface reports. */
export const SHATTER_DEBUG_VERSION = 1;

/** The seed `reset()` uses when its caller names none. */
export const DEFAULT_SEED = 1;
