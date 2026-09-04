// Shatter — the debugging and automation surface, `window.__shatter`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// THE RULE THE WHOLE SURFACE IS BUILT TO is that each operation is a READ of the
// state, a POSE of ONE field of it, or a MOVE OF THE CLOCK, and that `snapshot`
// reports every field an operation can set — so every operation is verifiable by
// setting a value and reading it back. Nothing here takes a partial object and
// applies whichever fields it happens to carry, because that would make this
// build's state layout a requirement on every other build; and nothing here
// arranges several things at once, because emptying the world is a sequence of
// the per-roster clears rather than an operation of its own.
//
// A POSE ARRANGES THE WORLD AND NEVER FABRICATES AN OUTCOME. Every call below
// puts the game into a situation and then stands back: the game's own stepping,
// gravity, collision, scoring and wave rules run from there exactly as they do in
// play, so a scenario driven from code behaves exactly like one played by hand.
//
// THE TWO EXCEPTIONS ARE THE CLOCK. `setAutoStep` and `advance` reach past the
// state into the runtime, because this build stands on no engine and nothing
// outside it owns its clock. Everything else about driving a browser game stays
// absent: there is no `keyDown`, `keyUp` or `press` — the runtime's registered
// actions are driven by dispatching real key events at the page — no `setMuted`,
// because mute is reached through its key the way a player reaches it, and no
// overlay operation, because the runtime draws the panel and owns the backtick
// key.

import {
  DEFAULT_SEED,
  SAUCER_SPEED,
  SHATTER_DEBUG_VERSION,
  type RockSize,
  type Screen,
} from "./constants";
import { makeBullet, makeEnemyBullet, makeRock, makeSaucer } from "./entities";
import { menuItemRect, type Rect } from "./menus";
import { seed } from "./rng";
import type { ShatterState } from "./types";
import { toTitle } from "./world";

/** The `window` property the surface is installed on. */
export const SHATTER_HANDLE = "__shatter";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Whether the frame loop advances the simulation from the wall clock. */
  autoStep(): boolean;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run whole simulation ticks immediately. */
  advance(ticks: number): void;
}

/** The ship, as `snapshot` reports it. */
export interface ShipSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** The magnitude of the velocity, built at the call. */
  speed: number;
  thrusting: boolean;
  invuln: number;
  collision: boolean;
  /** Whole ticks until the gun may fire again. */
  fireCooldown: number;
}

/** One of the ship's bullets, or one of the saucer's, as `snapshot` reports it. */
export interface ShotSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The seconds of life left. */
  life: number;
}

/** A rock, as `snapshot` reports it. */
export interface RockSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  /** The collision radius its size fixes, built at the call. */
  radius: number;
}

/** The saucer, as `snapshot` reports it. */
export interface SaucerSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mind: boolean;
  gun: boolean;
  travel: boolean;
}

/** The plain, JSON-serializable view `snapshot` returns. */
export interface ShatterSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  score: number;
  /** Ships left, INCLUDING the one in play. */
  lives: number;
  wave: number;
  /** Seconds left on the `WAVE N` banner; `0` when none is showing. */
  waveBanner: number;
  muted: boolean;
  waveSpawning: boolean;
  saucerSpawning: boolean;
  /** Whether the frame loop advances the simulation. */
  autoStep: boolean;
  ship: ShipSnapshot;
  bullets: ShotSnapshot[];
  rocks: RockSnapshot[];
  saucer: SaucerSnapshot | null;
  enemyBullets: ShotSnapshot[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/** Every operation `specs/instrumentation.md` names, and the version. */
export interface ShatterDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): ShatterSnapshot;
  menuItemRect(index: number): Rect | null;

  setAutoStep(enabled: boolean): void;
  advance(ticks: number): void;

  setScreen(screen: Screen): void;
  setMenuIndex(n: number): void;
  setScore(n: number): void;
  setLives(n: number): void;
  setWave(n: number): void;
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

/** A finite number, or `fallback` where the caller passed something else. */
function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: ShatterState,
  clock: DebugClock,
): ShatterDebugApi {
  /** One entity of a roster by id, or `undefined`. An unknown id is a no-op. */
  const byId = <T extends { id: number }>(
    roster: T[],
    id: number,
  ): T | undefined => roster.find((entry) => entry.id === id);

  return {
    version: SHATTER_DEBUG_VERSION,

    /**
     * Restore every declared field of the state to its title-screen value and
     * seed the game's randomness.
     *
     * `muted` is deliberately untouched, because muting is a player preference
     * the runtime owns. The clock is untouched too: whether the game is stepping
     * itself is not a declared field of the state, `setAutoStep` is how that is
     * said, and a caller that resets mid-scenario means to re-pose the world
     * rather than to hand it back to real time.
     */
    reset(options) {
      toTitle(state);
      seed(state, finite(options?.seed ?? DEFAULT_SEED, DEFAULT_SEED));
    },

    /** A pure read. It changes nothing. */
    // Where the build laid the entry out, which `specs/ui.md` leaves to the
    // build and a pointer check has to be told (`specs/instrumentation.md`).
    menuItemRect(index: number) {
      return menuItemRect(state.screen, index);
    },

    snapshot() {
      const ship = state.ship;
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
        autoStep: clock.autoStep(),
        ship: {
          x: ship.x,
          y: ship.y,
          vx: ship.vx,
          vy: ship.vy,
          angle: ship.angle,
          speed: Math.hypot(ship.vx, ship.vy),
          thrusting: ship.thrusting,
          invuln: ship.invuln,
          collision: ship.collision,
          fireCooldown: ship.fireCooldown,
        },
        bullets: state.bullets.map((bullet) => ({
          id: bullet.id,
          x: bullet.x,
          y: bullet.y,
          vx: bullet.vx,
          vy: bullet.vy,
          life: bullet.life,
        })),
        rocks: state.rocks.map((rock) => ({
          id: rock.id,
          x: rock.x,
          y: rock.y,
          vx: rock.vx,
          vy: rock.vy,
          size: rock.size,
          radius: rock.radius,
        })),
        saucer:
          state.saucer === null
            ? null
            : {
                id: state.saucer.id,
                x: state.saucer.x,
                y: state.saucer.y,
                vx: state.saucer.vx,
                vy: state.saucer.vy,
                mind: state.saucer.mind,
                gun: state.saucer.gun,
                travel: state.saucer.travel,
              },
        enemyBullets: state.enemyBullets.map((bullet) => ({
          id: bullet.id,
          x: bullet.x,
          y: bullet.y,
          vx: bullet.vx,
          vy: bullet.vy,
          life: bullet.life,
        })),
        simTime: state.simTime,
      };
    },

    /**
     * Take the game off real time, and give it back.
     *
     * Drawing is unaffected either way: the loop keeps rendering, so the canvas
     * shows the state the most recent tick left. It changes no game state.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run whole simulation ticks immediately and in order, each worth exactly one
     * `TICK_DT`, followed by a render.
     *
     * Advancing while the game is still stepping itself ADDS to what the wall
     * clock is already doing, so call `setAutoStep(false)` first.
     */
    advance(ticks) {
      clock.advance(ticks);
    },

    setScreen(screen) {
      state.screen = screen;
    },

    setMenuIndex(n) {
      state.menuIndex = Math.round(finite(n, 0));
    },

    /**
     * Set the score as a precondition.
     *
     * It grants no extra ship whatever multiple of `EXTRA_LIFE_STEP` it carries
     * the score across: the award belongs to the scoring path, which counts the
     * multiples a PAYMENT crossed.
     */
    setScore(n) {
      state.score = finite(n, state.score);
    },

    setLives(n) {
      state.lives = Math.round(finite(n, state.lives));
    },

    /** Set the wave number. It spawns no rocks and clears none. */
    setWave(n) {
      state.wave = Math.round(finite(n, state.wave));
    },

    /**
     * Set the seconds left on the banner; `0` clears it.
     *
     * It sets the timer and nothing else. The banner is the whole of the arming
     * (`src/waves.ts`), so a posed banner runs down and puts up the wave its
     * number names exactly as an earned one does, and posing `0` takes the
     * banner and the wave behind it away together — which is what
     * `specs/instrumentation.md` states of the operation.
     */
    setWaveBanner(seconds) {
      state.waveBanner = Math.max(0, finite(seconds, 0));
    },

    setWaveSpawning(enabled) {
      state.waveSpawning = Boolean(enabled);
    },

    setSaucerSpawning(enabled) {
      state.saucerSpawning = Boolean(enabled);
    },

    setShipPosition(x, y) {
      state.ship.x = finite(x, state.ship.x);
      state.ship.y = finite(y, state.ship.y);
    },

    setShipVelocity(vx, vy) {
      state.ship.vx = finite(vx, state.ship.vx);
      state.ship.vy = finite(vy, state.ship.vy);
    },

    /** Set the facing. It changes no velocity. */
    setShipAngle(radians) {
      state.ship.angle = finite(radians, state.ship.angle);
    },

    /**
     * Set the seconds of respawn grace remaining; `0` clears it, so lethal
     * contact resumes. It sets the timer alone, and whether a contact then
     * destroys the ship is decided by the game's own collision rules.
     */
    setShipInvuln(seconds) {
      state.ship.invuln = Math.max(0, finite(seconds, 0));
    },

    setFireCooldown(ticks) {
      state.ship.fireCooldown = Math.max(0, Math.round(finite(ticks, 0)));
    },

    /**
     * Gate the ship's lethal contact test, and nothing else. Off, the ship still
     * flies, still turns, still fires, and still slides along the star's core.
     */
    setShipCollision(enabled) {
      state.ship.collision = Boolean(enabled);
    },

    addBullet(x, y, vx, vy) {
      state.bullets.push(
        makeBullet(
          state,
          finite(x, 0),
          finite(y, 0),
          finite(vx, 0),
          finite(vy, 0),
        ),
      );
    },

    removeBullet(id) {
      state.bullets = state.bullets.filter((bullet) => bullet.id !== id);
    },

    clearBullets() {
      state.bullets = [];
    },

    addEnemyBullet(x, y, vx, vy) {
      state.enemyBullets.push(
        makeEnemyBullet(
          state,
          finite(x, 0),
          finite(y, 0),
          finite(vx, 0),
          finite(vy, 0),
        ),
      );
    },

    removeEnemyBullet(id) {
      state.enemyBullets = state.enemyBullets.filter(
        (bullet) => bullet.id !== id,
      );
    },

    clearEnemyBullets() {
      state.enemyBullets = [];
    },

    /**
     * Add one rock of `size` AT REST, appended with a fresh id.
     *
     * At rest rather than drifting, so the pose is the caller's alone and
     * `setRockVelocity` is verifiable by setting a value and reading it back. A
     * rock at rest is a legal state the well immediately begins to act on.
     */
    addRock(size, x, y) {
      state.rocks.push(makeRock(state, size, finite(x, 0), finite(y, 0), 0, 0));
    },

    setRockVelocity(id, vx, vy) {
      const rock = byId(state.rocks, id);
      if (rock === undefined) return;
      rock.vx = finite(vx, rock.vx);
      rock.vy = finite(vy, rock.vy);
    },

    removeRock(id) {
      state.rocks = state.rocks.filter((rock) => rock.id !== id);
    },

    /**
     * Remove every rock, leaving the bullets, saucer bullets and the saucer
     * standing. It destroys nothing and scores nothing, so a field it emptied has
     * had no rock destroyed on that tick and is a wave being played rather than a
     * wave cleared.
     */
    clearRocks() {
      state.rocks = [];
    },

    /**
     * Bring a saucer onto the field travelling right at cruise, with its clocks
     * set the way an arrival sets them and all three faculties running. It
     * replaces any saucer already up.
     */
    addSaucer(x, y) {
      state.saucer = makeSaucer(
        state,
        finite(x, 0),
        finite(y, 0),
        SAUCER_SPEED,
      );
    },

    setSaucerVelocity(vx, vy) {
      if (state.saucer === null) return;
      state.saucer.vx = finite(vx, state.saucer.vx);
      state.saucer.vy = finite(vy, state.saucer.vy);
    },

    removeSaucer() {
      state.saucer = null;
    },

    setSaucerMind(enabled) {
      if (state.saucer === null) return;
      state.saucer.mind = Boolean(enabled);
    },

    setSaucerGun(enabled) {
      if (state.saucer === null) return;
      state.saucer.gun = Boolean(enabled);
    },

    setSaucerTravel(enabled) {
      if (state.saucer === null) return;
      state.saucer.travel = Boolean(enabled);
    },
  };
}

/**
 * Install the surface on `window.__shatter` and return the function that removes
 * it again, while the installed object is still the one this call published.
 */
export function installDebugApi(
  state: ShatterState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[SHATTER_HANDLE] = api;
  return () => {
    if (target[SHATTER_HANDLE] === api) delete target[SHATTER_HANDLE];
  };
}
