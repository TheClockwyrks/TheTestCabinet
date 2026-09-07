// Shatter — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it and `initialize` returns it beside the state, as
// `[state, createDebugApi()]`. The engine holds the second element and hands it
// back from `engine.debug`, and that is the one way a caller reaches it: nothing
// is installed on the page. It reaches nothing global, holds no state, and is
// inert during normal play.
//
// Every operation is written in the shape of `update`, because nothing in this
// build holds a writable state. A POSE takes the current state and returns the
// next one, and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.setShipPosition(s, 640, 560))`. A READING
// takes the current state and returns what it read, as
// `debug.snapshot(engine.state)`.
//
// AN OPERATION IS UNCONDITIONAL. Every pose below applies its effect, reaching
// the value it was given rather than one the game's own rules would have
// preferred: nothing is clamped into range and nothing is declined. Where the
// specification fixes a domain — `1` to a size's full health, a charge of `0` to
// `1`, an id a live entity carries — that domain is checked and a call outside it
// THROWS, where the caller sees it. What nothing below does is refuse quietly: no
// pose returns a state equal to the one it was handed, because a surface that did
// that would hide the very systems a check drove it to reach.
//
// Each pose SETS ONE FIELD and takes scalars. There is no operation that takes a
// patch, none that arranges several things at once, and none that fabricates an
// outcome: a pose puts the game into a situation, and the game's own stepping,
// gravity, collision, scoring and wave rules are what run from there when the
// engine advances a frame. Emptying the world is four clears in a row, which is
// the caller's sequence to write rather than an operation here.
//
// Everything about DRIVING A BROWSER GAME rather than about Shatter belongs to
// the engine and is deliberately absent: there is no clock operation (the engine
// owns the clock and runs exact frames), no key operation (the registered
// actions are driven directly), no overlay toggle (the engine draws the panel
// and owns the backtick key), and no `setMuted` (the engine owns the mute bit;
// the `mute` binding sets it and the snapshot reports it).

import {
  BULLET_LIFE,
  DEFAULT_SEED,
  ROCK_HEALTH,
  ROCK_RADIUS,
  SAUCER_BULLET_LIFE,
  SHATTER_DEBUG_VERSION,
  type RockSize,
} from "./constants";
import { menuItemRect, type Rect } from "./menus";
import { addRock as addRockAt } from "./rocks";
import { addSaucerAt } from "./saucer";
import { titleState } from "./flow";
import { addTorpedoAt } from "./weapons";
import { takeId, toSim, type MutBullet, type Sim } from "./sim";
import type { Screen, ShatterState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** The plain, JSON-serializable view `snapshot` returns. */
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
  ship: {
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
  };
  bullets: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
  }[];
  rocks: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: RockSize;
    radius: number;
    health: number;
  }[];
  saucer: {
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
  } | null;
  enemyBullets: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
  }[];
  torpedoes: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    heading: number;
    life: number;
    homing: boolean;
  }[];
  torpedoCharge: number;
  torpedoReady: boolean;
  simTime: number;
}

/** The surface `initialize` returns beside the state. */
export interface ShatterDebugApi {
  version: number;

  reset(
    state: DeepReadonly<ShatterState>,
    options?: { seed?: number },
  ): ShatterState;
  snapshot(state: DeepReadonly<ShatterState>): ShatterSnapshot;
  /** Bring every reported reading into agreement with the field as it stands. */
  reconcile(state: DeepReadonly<ShatterState>): ShatterState;
  menuItemRect(state: DeepReadonly<ShatterState>, index: number): Rect | null;

  setScreen(state: DeepReadonly<ShatterState>, screen: Screen): ShatterState;
  setMenuIndex(state: DeepReadonly<ShatterState>, n: number): ShatterState;
  setScore(state: DeepReadonly<ShatterState>, n: number): ShatterState;
  setLives(state: DeepReadonly<ShatterState>, n: number): ShatterState;
  setWave(state: DeepReadonly<ShatterState>, n: number): ShatterState;
  setWaveBanner(
    state: DeepReadonly<ShatterState>,
    seconds: number,
  ): ShatterState;

  setWaveSpawning(
    state: DeepReadonly<ShatterState>,
    enabled: boolean,
  ): ShatterState;
  setSaucerSpawning(
    state: DeepReadonly<ShatterState>,
    enabled: boolean,
  ): ShatterState;

  setShipPosition(
    state: DeepReadonly<ShatterState>,
    x: number,
    y: number,
  ): ShatterState;
  setShipVelocity(
    state: DeepReadonly<ShatterState>,
    vx: number,
    vy: number,
  ): ShatterState;
  setShipAngle(
    state: DeepReadonly<ShatterState>,
    radians: number,
  ): ShatterState;
  setShipInvuln(
    state: DeepReadonly<ShatterState>,
    seconds: number,
  ): ShatterState;
  setFireCooldown(
    state: DeepReadonly<ShatterState>,
    ticks: number,
  ): ShatterState;
  setShipCollision(
    state: DeepReadonly<ShatterState>,
    enabled: boolean,
  ): ShatterState;

  addBullet(
    state: DeepReadonly<ShatterState>,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): ShatterState;
  removeBullet(state: DeepReadonly<ShatterState>, id: number): ShatterState;
  clearBullets(state: DeepReadonly<ShatterState>): ShatterState;
  addEnemyBullet(
    state: DeepReadonly<ShatterState>,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): ShatterState;
  removeEnemyBullet(
    state: DeepReadonly<ShatterState>,
    id: number,
  ): ShatterState;
  clearEnemyBullets(state: DeepReadonly<ShatterState>): ShatterState;

  addRock(
    state: DeepReadonly<ShatterState>,
    size: RockSize,
    x: number,
    y: number,
  ): ShatterState;
  setRockVelocity(
    state: DeepReadonly<ShatterState>,
    id: number,
    vx: number,
    vy: number,
  ): ShatterState;
  setRockHealth(
    state: DeepReadonly<ShatterState>,
    id: number,
    hp: number,
  ): ShatterState;
  removeRock(state: DeepReadonly<ShatterState>, id: number): ShatterState;
  clearRocks(state: DeepReadonly<ShatterState>): ShatterState;

  addSaucer(
    state: DeepReadonly<ShatterState>,
    x: number,
    y: number,
  ): ShatterState;
  setSaucerVelocity(
    state: DeepReadonly<ShatterState>,
    vx: number,
    vy: number,
  ): ShatterState;
  removeSaucer(state: DeepReadonly<ShatterState>): ShatterState;
  setSaucerMind(
    state: DeepReadonly<ShatterState>,
    enabled: boolean,
  ): ShatterState;
  setSaucerGun(
    state: DeepReadonly<ShatterState>,
    enabled: boolean,
  ): ShatterState;
  setSaucerTravel(
    state: DeepReadonly<ShatterState>,
    enabled: boolean,
  ): ShatterState;

  setTorpedoCharge(
    state: DeepReadonly<ShatterState>,
    fraction: number,
  ): ShatterState;
  addTorpedo(
    state: DeepReadonly<ShatterState>,
    x: number,
    y: number,
    heading: number,
  ): ShatterState;
  setTorpedoHeading(
    state: DeepReadonly<ShatterState>,
    id: number,
    radians: number,
  ): ShatterState;
  setTorpedoHoming(
    state: DeepReadonly<ShatterState>,
    id: number,
    enabled: boolean,
  ): ShatterState;
  removeTorpedo(state: DeepReadonly<ShatterState>, id: number): ShatterState;
  clearTorpedoes(state: DeepReadonly<ShatterState>): ShatterState;
}

/** Run `pose` over a writable copy of the state, and return the copy. */
function pose(
  state: DeepReadonly<ShatterState>,
  change: (sim: Sim) => void,
): ShatterState {
  const sim = toSim(state);
  change(sim);
  return sim;
}

/**
 * One entity of a roster by id, or a caller error naming the id.
 *
 * An id no live entity carries names no state to reach, so it throws where the
 * caller sees it rather than leaving the pose to return the state it was handed.
 */
function byId<T extends { id: number }>(
  op: string,
  roster: readonly T[],
  id: number,
): T {
  const found = roster.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new RangeError(`Shatter: ${op} names no live entity with id ${id}`);
  }
  return found;
}

/** The saucer on the field, or a caller error. */
function theSaucer(op: string, sim: Sim): NonNullable<Sim["saucer"]> {
  if (sim.saucer === null) {
    throw new RangeError(`Shatter: ${op} needs a saucer on the field`);
  }
  return sim.saucer;
}

/**
 * The finite number the caller passed, inside the closed range the specs fix.
 *
 * The bound is a constant `specs/instrumentation.md` states, so it is the
 * argument's DOMAIN rather than an edge to snap to: a call outside it fails
 * loudly rather than being clamped into range, which would leave the state
 * holding a value nobody asked for.
 */
function inRange(op: string, value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value) || value < lo || value > hi) {
    throw new RangeError(
      `Shatter: ${op} needs a finite number in [${lo}, ${hi}], got ${String(value)}`,
    );
  }
  return value;
}

/** One round in flight, of either side's, at full life. */
function round(
  sim: Sim,
  x: number,
  y: number,
  vx: number,
  vy: number,
  life: number,
): MutBullet {
  return { id: takeId(sim), x, y, vx, vy, life };
}

/** Build the surface. It holds nothing; every operation is over the state. */
export function createDebugApi(): ShatterDebugApi {
  return {
    version: SHATTER_DEBUG_VERSION,

    reset: (state, options) =>
      titleState(options?.seed ?? DEFAULT_SEED, state.muted),

    /**
     * Bring every reported reading into agreement with the field as it stands.
     *
     * Every derived reading this build reports — the ship's `speed`, each rock's
     * `radius`, and `torpedoReady` — is worked out at the READ, in `snapshot`
     * below, from the velocity, the size and the charge beside it. Nothing is
     * held that a pose can leave behind, so there is nothing here to rewrite and
     * the state that comes back equals the one that went in.
     *
     * The operation is required of EVERY build, including one that keeps those
     * readings as stored copies and must rewrite them from their sources here.
     * This is what it comes to in a build that does not: it advances no frame,
     * runs no system, fires nothing, and corrects nothing. The empty `pose` is
     * what keeps the return type right without a cast.
     */
    reconcile: (state) => pose(state, () => {}),

    // Where the build laid the entry out, which `specs/ui.md` leaves to the
    // build and a pointer check has to be told (`specs/instrumentation.md`).
    menuItemRect: (state, index) => menuItemRect(state.screen, index),

    snapshot: (state) => ({
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
        x: state.ship.x,
        y: state.ship.y,
        vx: state.ship.vx,
        vy: state.ship.vy,
        angle: state.ship.angle,
        speed: Math.hypot(state.ship.vx, state.ship.vy),
        thrusting: state.ship.thrusting,
        invuln: state.ship.invuln,
        collision: state.ship.collision,
        fireCooldown: state.ship.fireCooldown,
      },
      bullets: state.bullets.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        life: b.life,
      })),
      rocks: state.rocks.map((r) => ({
        id: r.id,
        x: r.x,
        y: r.y,
        vx: r.vx,
        vy: r.vy,
        size: r.size,
        radius: ROCK_RADIUS[r.size],
        health: r.health,
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
              fireClock: state.saucer.fireClock,
              weaveClock: state.saucer.weaveClock,
              age: state.saucer.age,
            },
      enemyBullets: state.enemyBullets.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        life: b.life,
      })),
      torpedoes: state.torpedoes.map((t) => ({
        id: t.id,
        x: t.x,
        y: t.y,
        vx: t.vx,
        vy: t.vy,
        heading: t.heading,
        life: t.life,
        homing: t.homing,
      })),
      torpedoCharge: state.torpedoCharge,
      torpedoReady: state.torpedoCharge >= 1,
      simTime: state.simTime,
    }),

    // ---- The screen and the run -----------------------------------------

    setScreen: (state, screen) =>
      pose(state, (sim) => {
        sim.screen = screen;
      }),
    setMenuIndex: (state, n) =>
      pose(state, (sim) => {
        sim.menuIndex = n;
      }),
    setScore: (state, n) =>
      pose(state, (sim) => {
        // A pose is a precondition: it grants no extra ship, whatever multiple
        // of EXTRA_LIFE_STEP it carries the score across.
        sim.score = n;
      }),
    setLives: (state, n) =>
      pose(state, (sim) => {
        sim.lives = n;
      }),
    setWave: (state, n) =>
      pose(state, (sim) => {
        sim.wave = n;
      }),
    setWaveBanner: (state, seconds) =>
      pose(state, (sim) => {
        sim.waveBanner = seconds;
      }),

    // ---- The world gates -------------------------------------------------

    setWaveSpawning: (state, enabled) =>
      pose(state, (sim) => {
        sim.waveSpawning = enabled;
      }),
    setSaucerSpawning: (state, enabled) =>
      pose(state, (sim) => {
        sim.saucerSpawning = enabled;
      }),

    // ---- The ship --------------------------------------------------------

    setShipPosition: (state, x, y) =>
      pose(state, (sim) => {
        sim.ship.x = x;
        sim.ship.y = y;
      }),
    setShipVelocity: (state, vx, vy) =>
      pose(state, (sim) => {
        sim.ship.vx = vx;
        sim.ship.vy = vy;
      }),
    setShipAngle: (state, radians) =>
      pose(state, (sim) => {
        sim.ship.angle = radians;
      }),
    setShipInvuln: (state, seconds) =>
      pose(state, (sim) => {
        sim.ship.invuln = seconds;
      }),
    setFireCooldown: (state, ticks) =>
      pose(state, (sim) => {
        sim.ship.fireCooldown = ticks;
      }),
    setShipCollision: (state, enabled) =>
      pose(state, (sim) => {
        sim.ship.collision = enabled;
      }),

    // ---- The bullets -----------------------------------------------------

    addBullet: (state, x, y, vx, vy) =>
      pose(state, (sim) => {
        sim.bullets.push(round(sim, x, y, vx, vy, BULLET_LIFE));
      }),
    removeBullet: (state, id) =>
      pose(state, (sim) => {
        byId("removeBullet", sim.bullets, id);
        sim.bullets = sim.bullets.filter((b) => b.id !== id);
      }),
    clearBullets: (state) =>
      pose(state, (sim) => {
        sim.bullets = [];
      }),
    addEnemyBullet: (state, x, y, vx, vy) =>
      pose(state, (sim) => {
        sim.enemyBullets.push(round(sim, x, y, vx, vy, SAUCER_BULLET_LIFE));
      }),
    removeEnemyBullet: (state, id) =>
      pose(state, (sim) => {
        byId("removeEnemyBullet", sim.enemyBullets, id);
        sim.enemyBullets = sim.enemyBullets.filter((b) => b.id !== id);
      }),
    clearEnemyBullets: (state) =>
      pose(state, (sim) => {
        sim.enemyBullets = [];
      }),

    // ---- The rocks -------------------------------------------------------

    addRock: (state, size, x, y) =>
      pose(state, (sim) => {
        addRockAt(sim, size, x, y);
      }),
    setRockVelocity: (state, id, vx, vy) =>
      pose(state, (sim) => {
        const rock = byId("setRockVelocity", sim.rocks, id);
        rock.vx = vx;
        rock.vy = vy;
      }),
    setRockHealth: (state, id, hp) =>
      pose(state, (sim) => {
        const rock = byId("setRockHealth", sim.rocks, id);
        rock.health = inRange(
          "setRockHealth(hp)",
          hp,
          1,
          ROCK_HEALTH[rock.size],
        );
      }),
    removeRock: (state, id) =>
      pose(state, (sim) => {
        byId("removeRock", sim.rocks, id);
        sim.rocks = sim.rocks.filter((rock) => rock.id !== id);
      }),
    clearRocks: (state) =>
      pose(state, (sim) => {
        // It destroys nothing and scores nothing, so a field it emptied has had
        // no rock destroyed on that tick and no wave has cleared.
        sim.rocks = [];
      }),

    // ---- The saucer ------------------------------------------------------

    addSaucer: (state, x, y) =>
      pose(state, (sim) => {
        addSaucerAt(sim, x, y);
      }),
    setSaucerVelocity: (state, vx, vy) =>
      pose(state, (sim) => {
        const saucer = theSaucer("setSaucerVelocity", sim);
        saucer.vx = vx;
        saucer.vy = vy;
      }),
    removeSaucer: (state) =>
      pose(state, (sim) => {
        sim.saucer = null;
      }),
    setSaucerMind: (state, enabled) =>
      pose(state, (sim) => {
        theSaucer("setSaucerMind", sim).mind = enabled;
      }),
    setSaucerGun: (state, enabled) =>
      pose(state, (sim) => {
        theSaucer("setSaucerGun", sim).gun = enabled;
      }),
    setSaucerTravel: (state, enabled) =>
      pose(state, (sim) => {
        theSaucer("setSaucerTravel", sim).travel = enabled;
      }),

    // ---- The torpedoes ---------------------------------------------------

    setTorpedoCharge: (state, fraction) =>
      pose(state, (sim) => {
        sim.torpedoCharge = inRange(
          "setTorpedoCharge(fraction)",
          fraction,
          0,
          1,
        );
      }),
    addTorpedo: (state, x, y, heading) =>
      pose(state, (sim) => {
        addTorpedoAt(sim, x, y, heading);
      }),
    setTorpedoHeading: (state, id, radians) =>
      pose(state, (sim) => {
        const torpedo = byId("setTorpedoHeading", sim.torpedoes, id);
        const speed = Math.hypot(torpedo.vx, torpedo.vy);
        torpedo.heading = radians;
        torpedo.vx = Math.cos(radians) * speed;
        torpedo.vy = Math.sin(radians) * speed;
      }),
    setTorpedoHoming: (state, id, enabled) =>
      pose(state, (sim) => {
        byId("setTorpedoHoming", sim.torpedoes, id).homing = enabled;
      }),
    removeTorpedo: (state, id) =>
      pose(state, (sim) => {
        byId("removeTorpedo", sim.torpedoes, id);
        sim.torpedoes = sim.torpedoes.filter((torpedo) => torpedo.id !== id);
      }),
    clearTorpedoes: (state) =>
      pose(state, (sim) => {
        sim.torpedoes = [];
      }),
  };
}
