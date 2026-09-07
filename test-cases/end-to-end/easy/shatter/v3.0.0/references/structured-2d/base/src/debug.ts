// Shatter — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and returns it from `engine.debug` — the
// one way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching
// the open world through the accessor the instance supplies — `engine.world` at
// the call — and takes only the parameters its own row names. A POSE arranges
// the running game and returns nothing; a READING returns plain data built at
// the call and changes nothing.
//
// EACH POSE SETS ONE FIELD. There is no operation that takes a patch or a bag
// of options: a rock is added at a position and then given a velocity, each
// roster has its own clear and its own removal by id, and each faculty is its
// own switch. That is what makes every pose verifiable by setting a value and
// reading it back through `snapshot`, and it is why the snapshot reports every
// field a pose can set.
//
// THE TWO WORLD GATES are the ones worth naming: `setWaveSpawning` and
// `setSaucerSpawning` each hold one faculty of the game itself, default to on,
// are restored to on by `reset`, and are reported by `snapshot`. With the
// ship's own `setShipCollision` beside them they are what let a scenario pose a
// field holding only what its requirement concerns.
//
// The surface holds no state and is inert during normal play: nothing below
// runs until something calls it.

import type { World } from "@clockwyrks/structured-2d";
import {
  DEFAULT_SEED,
  ROCK_RADIUS,
  SHATTER_DEBUG_VERSION,
  type RockSize,
} from "./constants";
import {
  addBulletTo,
  addEnemyBulletTo,
  addRockTo,
  addSaucerTo,
} from "./entities";
import { resetState } from "./flow";
import { menuItemRect, type Rect } from "./menus";
import {
  shatterState,
  type BulletState,
  type Screen,
  type ShatterState,
} from "./game";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

export interface SnapshotShip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  speed: number;
  thrusting: boolean;
  invuln: number;
  collision: boolean;
  fireCooldown: number;
}

export interface SnapshotBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface SnapshotRock {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  radius: number;
}

export interface SnapshotSaucer {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mind: boolean;
  gun: boolean;
  travel: boolean;
  fireClock: number;
  weaveClock: number;
  age: number;
}

export interface ShatterSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  score: number;
  lives: number;
  wave: number;
  waveBanner: number;
  muted: boolean;
  waveSpawning: boolean;
  saucerSpawning: boolean;
  saucerClock: number;
  saucerDue: number;
  ship: SnapshotShip;
  bullets: SnapshotBullet[];
  rocks: SnapshotRock[];
  saucer: SnapshotSaucer | null;
  enemyBullets: SnapshotBullet[];
  simTime: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose acts on the live game at the call and returns
 * nothing; the one reading, `snapshot`, returns what it read.
 */
export interface ShatterDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): ShatterSnapshot;
  /** Bring every reported reading into agreement with the field as it stands. */
  reconcile(): void;
  menuItemRect(index: number): Rect | null;

  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setWave(wave: number): void;
  setWaveBanner(seconds: number): void;

  setWaveSpawning(enabled: boolean): void;
  setSaucerSpawning(enabled: boolean): void;

  setShipPosition(x: number, y: number): void;
  setShipVelocity(vx: number, vy: number): void;
  setShipAngle(radians: number): void;
  setShipInvuln(seconds: number): void;
  setFireCooldown(ticks: number): void;
  setShipCollision(enabled: boolean): void;

  addBullet(x: number, y: number, vx: number, vy: number): void;
  removeBullet(id: number): void;
  clearBullets(): void;
  addEnemyBullet(x: number, y: number, vx: number, vy: number): void;
  removeEnemyBullet(id: number): void;
  clearEnemyBullets(): void;

  addRock(size: RockSize, x: number, y: number): void;
  setRockVelocity(id: number, vx: number, vy: number): void;
  removeRock(id: number): void;
  clearRocks(): void;

  addSaucer(x: number, y: number): void;
  setSaucerVelocity(vx: number, vy: number): void;
  removeSaucer(): void;
  setSaucerMind(enabled: boolean): void;
  setSaucerGun(enabled: boolean): void;
  setSaucerTravel(enabled: boolean): void;
}

/** One round in flight, as the snapshot reports it. */
function readBullet(bullet: BulletState): SnapshotBullet {
  return {
    id: bullet.id,
    x: bullet.x,
    y: bullet.y,
    vx: bullet.vx,
    vy: bullet.vy,
    life: bullet.life,
  };
}

/**
 * Build the surface over an accessor for the open world. It holds nothing:
 * every operation reads the world — and the state it carries — at the moment it
 * is called, so the surface follows the live game for the life of the engine.
 */
export function createDebugApi(world: () => World): ShatterDebugApi {
  const read = (): ShatterState => shatterState(world());

  /**
   * One entity of a roster by id, or a caller error naming the id.
   *
   * AN OPERATION IS UNCONDITIONAL, so an id no live entity carries names no
   * state to reach and throws where the caller sees it, rather than leaving the
   * pose to return with the roster exactly as it was. A surface that swallowed
   * it would grade a check that never addressed the entity it meant to as one
   * that did.
   */
  const byId = <T extends { id: number }>(
    op: string,
    roster: readonly T[],
    id: number,
  ): T => {
    const found = roster.find((entry) => entry.id === id);
    if (found === undefined) {
      throw new RangeError(`Shatter: ${op} names no live entity with id ${id}`);
    }
    return found;
  };

  /** The saucer on the field, or a caller error. */
  const theSaucer = (op: string): NonNullable<ShatterState["saucer"]> => {
    const saucer = read().saucer;
    if (saucer === null) {
      throw new RangeError(`Shatter: ${op} needs a saucer on the field`);
    }
    return saucer;
  };

  /**
   * The finite number the caller passed, at or above `floor`.
   *
   * The floor is a bound `specs/instrumentation.md` fixes as a constant, so it
   * is the argument's DOMAIN rather than an edge to snap to: a call outside it
   * fails loudly rather than being clamped into range, which would leave the
   * state holding a value nobody asked for.
   */
  const atLeast = (op: string, value: number, floor: number): number => {
    if (!Number.isFinite(value) || value < floor) {
      throw new RangeError(
        `Shatter: ${op} needs a finite number at or above ${floor}, got ${String(value)}`,
      );
    }
    return value;
  };

  return {
    version: SHATTER_DEBUG_VERSION,

    reset(options) {
      resetState(read(), options?.seed ?? DEFAULT_SEED);
    },

    /**
     * Bring every reported reading into agreement with the field as it stands.
     *
     * Every derived reading this build reports — the ship's `speed` and each
     * rock's `radius` — is worked out at the READ, in `snapshot` below, from the
     * velocity and the size beside it. Nothing is held that a pose can leave
     * behind, so there is nothing here to rewrite and this body is the answer
     * rather than an omission.
     *
     * The operation is required of EVERY build, including one that keeps those
     * readings as stored copies and must rewrite them from their sources here.
     * This is what it comes to in a build that does not. It advances no clock,
     * runs no system, fires nothing, and corrects nothing.
     */
    reconcile() {},

    // Where the build laid the entry out, which `specs/ui.md` leaves to the
    // build and a pointer check has to be told (`specs/instrumentation.md`).
    menuItemRect(index) {
      return menuItemRect(read().screen, index);
    },

    snapshot() {
      const state = read();
      const ship = state.ship;
      const saucer = state.saucer;
      return {
        version: SHATTER_DEBUG_VERSION,
        screen: state.screen,
        menuIndex: state.menuIndex,
        score: state.score,
        lives: state.lives,
        wave: state.wave,
        waveBanner: state.waveBanner,
        muted: state.muted,
        waveSpawning: state.waveSpawning,
        saucerSpawning: state.saucerSpawning,
        saucerClock: state.saucerClock,
        saucerDue: state.saucerDue,
        ship: {
          x: ship.x,
          y: ship.y,
          vx: ship.vx,
          vy: ship.vy,
          angle: ship.angle,
          // Built at the call from the fields beside it; no pose sets it.
          speed: Math.hypot(ship.vx, ship.vy),
          thrusting: ship.thrusting,
          invuln: ship.invuln,
          collision: ship.collision,
          fireCooldown: ship.fireCooldown,
        },
        bullets: state.bullets.map(readBullet),
        rocks: state.rocks.map((rock) => ({
          id: rock.id,
          x: rock.x,
          y: rock.y,
          vx: rock.vx,
          vy: rock.vy,
          size: rock.size,
          // The radius its size fixes, built at the call.
          radius: ROCK_RADIUS[rock.size],
        })),
        saucer:
          saucer === null
            ? null
            : {
                id: saucer.id,
                x: saucer.x,
                y: saucer.y,
                vx: saucer.vx,
                vy: saucer.vy,
                mind: saucer.mind,
                gun: saucer.gun,
                travel: saucer.travel,
                fireClock: saucer.fireClock,
                weaveClock: saucer.weaveClock,
                age: saucer.age,
              },
        enemyBullets: state.enemyBullets.map(readBullet),
        simTime: state.simTime,
      };
    },

    setScreen(screen) {
      read().screen = screen;
    },

    setMenuIndex(index) {
      read().menuIndex = atLeast("setMenuIndex(index)", index, 0);
    },

    /**
     * The score alone. It grants no extra ship whatever multiple of
     * `EXTRA_LIFE_STEP` it carries the score across: the award belongs to the
     * scoring path, and this is a precondition.
     */
    setScore(score) {
      read().score = score;
    },

    setLives(lives) {
      read().lives = lives;
    },

    /** The wave number alone: it spawns no rock and clears none. */
    setWave(wave) {
      read().wave = wave;
    },

    setWaveBanner(seconds) {
      read().waveBanner = atLeast("setWaveBanner(seconds)", seconds, 0);
    },

    setWaveSpawning(enabled) {
      read().waveSpawning = enabled;
    },

    setSaucerSpawning(enabled) {
      read().saucerSpawning = enabled;
    },

    setShipPosition(x, y) {
      const ship = read().ship;
      ship.x = x;
      ship.y = y;
    },

    setShipVelocity(vx, vy) {
      const ship = read().ship;
      ship.vx = vx;
      ship.vy = vy;
    },

    /** The facing alone. It changes no velocity. */
    setShipAngle(radians) {
      read().ship.angle = radians;
    },

    /**
     * The respawn grace's timer alone. Whether a contact then destroys the ship
     * is decided by the game's own collision rules.
     */
    setShipInvuln(seconds) {
      read().ship.invuln = atLeast("setShipInvuln(seconds)", seconds, 0);
    },

    setFireCooldown(ticks) {
      read().ship.fireCooldown = Math.round(
        atLeast("setFireCooldown(ticks)", ticks, 0),
      );
    },

    /**
     * The ship's LETHAL contact test alone. Off, the ship still flies, still
     * turns, still fires and still slides along the star's core.
     */
    setShipCollision(enabled) {
      read().ship.collision = enabled;
    },

    addBullet(x, y, vx, vy) {
      addBulletTo(read(), x, y, vx, vy);
    },

    removeBullet(id) {
      const state = read();
      byId("removeBullet", state.bullets, id);
      state.bullets = state.bullets.filter((bullet) => bullet.id !== id);
    },

    clearBullets() {
      read().bullets = [];
    },

    addEnemyBullet(x, y, vx, vy) {
      addEnemyBulletTo(read(), x, y, vx, vy);
    },

    removeEnemyBullet(id) {
      const state = read();
      byId("removeEnemyBullet", state.enemyBullets, id);
      state.enemyBullets = state.enemyBullets.filter(
        (bullet) => bullet.id !== id,
      );
    },

    clearEnemyBullets() {
      read().enemyBullets = [];
    },

    /** One rock of `size`, at rest, appended with a fresh id. */
    addRock(size, x, y) {
      addRockTo(read(), size, x, y);
    },

    setRockVelocity(id, vx, vy) {
      const rock = byId("setRockVelocity", read().rocks, id);
      rock.vx = vx;
      rock.vy = vy;
    },

    removeRock(id) {
      const state = read();
      byId("removeRock", state.rocks, id);
      state.rocks = state.rocks.filter((rock) => rock.id !== id);
    },

    /**
     * Every rock, and nothing else. It destroys nothing and scores nothing, so
     * a field it emptied has had no rock destroyed on that tick and is a wave
     * being played rather than a wave cleared.
     */
    clearRocks() {
      read().rocks = [];
    },

    /** A saucer at cruise, all three faculties on, replacing any already up. */
    addSaucer(x, y) {
      addSaucerTo(read(), x, y);
    },

    setSaucerVelocity(vx, vy) {
      const saucer = theSaucer("setSaucerVelocity");
      saucer.vx = vx;
      saucer.vy = vy;
    },

    removeSaucer() {
      read().saucer = null;
    },

    setSaucerMind(enabled) {
      theSaucer("setSaucerMind").mind = enabled;
    },

    setSaucerGun(enabled) {
      theSaucer("setSaucerGun").gun = enabled;
    },

    setSaucerTravel(enabled) {
      theSaucer("setSaucerTravel").travel = enabled;
    },
  };
}
