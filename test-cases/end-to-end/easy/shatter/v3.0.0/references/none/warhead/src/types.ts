// Shatter — the shape of the game's state.
//
// `specs/state.md` says the build owns the shape entirely and then lists what the
// state must carry; `specs/instrumentation.md` fixes the one contract over it,
// which is that every operation the debug surface poses is honoured and every
// field it can pose is reported. This file is that list, as types.
//
// One value holds the whole game (`specs/overview.md`, hard requirements): the
// frame loop advances THIS object and the debug surface reads it. Nothing else in
// the build keeps game state of its own — the runtime beneath keeps the clock,
// the keyboard and the audio bus, and none of those is the game.

import type { CueName, RockSize, Screen } from "./constants";

/** A point or a vector in logical field units. */
export interface Vec {
  x: number;
  y: number;
}

/** The ship the player flies. There is exactly one, and no scenario removes it. */
export interface Ship {
  /** The centre. */
  x: number;
  y: number;
  /** The velocity, in units per second. */
  vx: number;
  vy: number;
  /** The facing, in radians. */
  angle: number;
  /** Whether thrust was applied on the most recent tick. */
  thrusting: boolean;
  /** The seconds of respawn grace left; `0` when none. */
  invuln: number;
  /** Whether the lethal contact test runs. `setShipCollision` gates this alone. */
  collision: boolean;
  /** Whole ticks until the gun may fire again. */
  fireCooldown: number;
}

/** One of the ship's bullets in flight. Ballistic: the well pulls it. */
export interface Bullet {
  /** Distinct among every entity live at this moment. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The seconds of life left. */
  life: number;
  /**
   * Where it stood on each of the last `TRAIL_TICKS` ticks, oldest first, so the
   * renderer can lay a tail along its recent path. Written once per tick and read
   * only by the renderer.
   */
  trail: Vec[];
}

/** A drifting rock. Ballistic: the well pulls it. */
export interface Rock {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  /** The collision radius its size fixes, carried for a cheap read. */
  radius: number;
  /** The current drawn rotation. Cosmetic: it never enters the simulation. */
  angle: number;
  /** The drawn rotation's rate, in radians per second. Cosmetic. */
  spin: number;
  /** Per-vertex radii of the drawn outline. Cosmetic; it collides as a circle. */
  verts: number[];
  /** The hits it has left. */
  health: number;
  /** The seconds of hit flash left after a hit that left it standing. */
  hitFlash: number;
}

/** The enemy saucer. There is one slot, empty when no saucer is up. */
export interface Saucer {
  /** Fresh on every arrival, and not reused while any live entity holds it. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Whether its steering decisions run. */
  mind: boolean;
  /** Whether its gun runs. */
  gun: boolean;
  /** Whether its locomotion runs. */
  travel: boolean;
  /** The seconds until its next shot. */
  fireTimer: number;
  /** The seconds until its weave rerolls. */
  weaveTimer: number;
  /** The seconds it has been on the field. */
  age: number;
}

/** A saucer bullet in flight. Ballistic: the well pulls it. */
export interface EnemyBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** A guided torpedo in flight. Powered: the well never pulls it. */
export interface Torpedo {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The heading, in radians. The velocity always follows it. */
  heading: number;
  life: number;
  /** Whether its guidance runs. `setTorpedoHoming` gates this alone. */
  homing: boolean;
}

/** The whole game, in one value. */
export interface ShatterState {
  // ---- The screen and the run ------------------------------------------
  /** The screen the game is showing. */
  screen: Screen;
  /** The highlighted entry of whichever menu the current screen shows. */
  menuIndex: number;
  /** The running score. */
  score: number;
  /** The ships left, counting the one being flown. */
  lives: number;
  /** The wave being played; `0` before the first. */
  wave: number;
  /** The seconds left on the `WAVE N` banner; `0` when none is showing. */
  waveBanner: number;

  // ---- The field --------------------------------------------------------
  ship: Ship;
  bullets: Bullet[];
  rocks: Rock[];
  saucer: Saucer | null;
  enemyBullets: EnemyBullet[];
  torpedoes: Torpedo[];
  /** The stored torpedo charge, from `0` to `1`. */
  torpedoCharge: number;

  // ---- The game's own spawners -----------------------------------------
  /** Whether the game's own wave loop runs. */
  waveSpawning: boolean;
  /** Whether the game's own arrival of a saucer runs. */
  saucerSpawning: boolean;
  /** How far the game is toward the next saucer arrival, in seconds. */
  saucerClock: number;
  /** What that clock must reach for the arrival to happen. */
  saucerDue: number;

  // ---- The rest ---------------------------------------------------------
  /** The fraction of a tick carried over from the previous frame, in seconds. */
  carry: number;
  /** The accumulated simulation time, which every tick adds `TICK_DT` to. */
  simTime: number;
  /** The game's copy of the runtime's mute bit, refreshed in every update. */
  muted: boolean;
  /** The whole state of the seeded generator every draw comes from. */
  rng: number;
  /** The id the next entity created will take. */
  nextId: number;

  // ---- Bookkeeping the rules above need --------------------------------
  /**
   * Whether a rock was destroyed on the tick being resolved.
   *
   * `specs/progression.md` makes clearing a wave a TRANSITION — the tick in which
   * the last rock is destroyed — rather than a condition on an empty field, so
   * the wave loop needs to know that a destruction happened and not merely that
   * nothing is left. Raised by the destruction, lowered at the end of the tick.
   */
  rockDestroyed: boolean;
  /** The seconds left on the awarded-ship announcement; `0` when none. */
  extraLifeShow: number;
  /** The cues raised on the tick being resolved, in the order they were raised. */
  cues: CueName[];
  /**
   * Every pointer and touch contact currently pressed, and the menu entry each
   * came down on.
   *
   * `specs/ui.md` gives a confirm two edges that may arrive frames apart, so the
   * entry a press landed in is remembered until its release arrives, per pointer
   * id so a second finger cannot take the first one's press away.
   */
  pointerPresses: PointerPress[];
}

/**
 * One pointer or touch contact currently pressed, and where it came down.
 *
 * `entry` is the menu entry the press landed in, or `-1` for a press that began
 * outside every region — which can never confirm, since `specs/ui.md` gives a
 * confirm both of its edges inside one region.
 */
export interface PointerPress {
  /** The pointer this press belongs to. Each touch contact has its own. */
  id: number;
  /** The entry the press came down on, or `-1` for none. */
  entry: number;
  /** The screen it came down on; a press does not survive a screen change. */
  screen: Screen;
}
