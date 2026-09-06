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
import { ROCK_RADIUS, SHATTER_DEBUG_VERSION, type RockSize } from "./constants";
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
  type FieldEdge,
  type SaucerEdge,
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
  weave: 1 | -1;
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
  nextSaucerEdge: SaucerEdge | null;
  nextSaucerRow: number | null;
  nextSaucerAim: number | null;
  nextRockSpeed: number | null;
  nextRecycleEdge: FieldEdge | null;
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

  reset(): void;
  snapshot(): ShatterSnapshot;
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
  setSaucerWeave(direction: number): void;
  setSaucerDue(seconds: number): void;

  setNextSaucerEdge(edge: SaucerEdge): void;
  setNextSaucerRow(y: number): void;
  setNextSaucerAim(radians: number): void;
  setNextRockSpeed(speed: number): void;
  setNextRecycleEdge(edge: FieldEdge): void;
}

/** The two edges a saucer enters at. */
const SAUCER_EDGES: readonly SaucerEdge[] = ["left", "right"];

/** The four edges a recycled rock re-enters at. */
const FIELD_EDGES: readonly FieldEdge[] = ["top", "bottom", "left", "right"];

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

  return {
    version: SHATTER_DEBUG_VERSION,

    reset() {
      resetState(read());
    },

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
        nextSaucerEdge: state.nextSaucerEdge,
        nextSaucerRow: state.nextSaucerRow,
        nextSaucerAim: state.nextSaucerAim,
        nextRockSpeed: state.nextRockSpeed,
        nextRecycleEdge: state.nextRecycleEdge,
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
                weave: saucer.weave,
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
      read().menuIndex = index;
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
      read().waveBanner = Math.max(0, seconds);
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
      read().ship.invuln = Math.max(0, seconds);
    },

    setFireCooldown(ticks) {
      read().ship.fireCooldown = Math.max(0, Math.round(ticks));
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
      const rock = read().rocks.find((entry) => entry.id === id);
      if (rock === undefined) return;
      rock.vx = vx;
      rock.vy = vy;
    },

    removeRock(id) {
      const state = read();
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
      const saucer = read().saucer;
      if (saucer === null) return;
      saucer.vx = vx;
      saucer.vy = vy;
    },

    removeSaucer() {
      read().saucer = null;
    },

    setSaucerMind(enabled) {
      const saucer = read().saucer;
      if (saucer !== null) saucer.mind = enabled;
    },

    setSaucerGun(enabled) {
      const saucer = read().saucer;
      if (saucer !== null) saucer.gun = enabled;
    },

    /** The direction its next reroll takes from rest. */
    setSaucerWeave(direction) {
      const saucer = read().saucer;
      if (saucer !== null) saucer.weave = direction < 0 ? -1 : 1;
    },

    /** The figure the gap draw decides; the clock itself stands where it is. */
    setSaucerDue(seconds) {
      if (Number.isFinite(seconds)) read().saucerDue = Math.max(0, seconds);
    },

    // ---- The posed draws -------------------------------------------------
    //
    // Each sets the outcome the game's next draw of one kind would decide, and
    // the draw that takes it returns the field to `null`
    // (`specs/instrumentation.md`). A value outside what the draw could decide
    // is ignored, so a field only ever holds an outcome the rule accepts.

    setNextSaucerEdge(edge) {
      if (SAUCER_EDGES.includes(edge)) read().nextSaucerEdge = edge;
    },

    setNextSaucerRow(y) {
      if (Number.isFinite(y)) read().nextSaucerRow = y;
    },

    setNextSaucerAim(radians) {
      if (Number.isFinite(radians)) read().nextSaucerAim = radians;
    },

    setNextRockSpeed(speed) {
      if (Number.isFinite(speed) && speed >= 0) read().nextRockSpeed = speed;
    },

    setNextRecycleEdge(edge) {
      if (FIELD_EDGES.includes(edge)) read().nextRecycleEdge = edge;
    },

    setSaucerTravel(enabled) {
      const saucer = read().saucer;
      if (saucer !== null) saucer.travel = enabled;
    },
  };
}
