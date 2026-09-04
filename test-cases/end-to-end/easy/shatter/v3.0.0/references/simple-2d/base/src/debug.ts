// Shatter — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it and `initialize` returns it beside the state, as
// `[state, createDebugApi()]`. The engine holds the second element and hands it
// back from `engine.debug`, and that is the one way a caller reaches it:
// nothing is installed on the page. It reaches nothing global, holds no state,
// and is inert during normal play.
//
// Every operation is written in the shape of `update`, because nothing in this
// build holds a writable state. A POSE takes the current state and returns the
// next one, and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.setShipPosition(s, 640, 560))`. A READING
// takes the current state and returns what it read, as
// `debug.snapshot(engine.state)`.
//
// Each pose SETS ONE FIELD, EMPTIES ONE ROSTER, or ADDS ONE ENTITY, and takes
// scalars. There is no patch operation, nothing that arranges several elements
// at once, and nothing that fabricates an outcome: a pose puts the game into a
// situation, and the game's own stepping, gravity, collision, scoring and wave
// rules are what run from there when the engine advances a frame. Every field a
// pose can set is reported by `snapshot`, so every one of them is verifiable by
// setting a value and reading it back.
//
// Everything about DRIVING A BROWSER GAME rather than about Shatter belongs to
// the engine and is deliberately absent: there is no clock operation (the
// engine owns the clock and runs exact frames), no key operation (the
// registered actions are driven directly), no overlay toggle (the engine draws
// the panel and owns the backtick key), and no `setMuted` (the engine owns the
// mute bit; the `mute` binding sets it and the snapshot reports it).

import {
  DEFAULT_SEED,
  SHATTER_DEBUG_VERSION,
  type RockSize,
} from "./constants";
import { addBullet, addEnemyBullet } from "./bullets";
import { resetToTitle } from "./flow";
import { menuItemRect, type Rect } from "./menus";
import { addRock, rockRadius } from "./rocks";
import { addSaucer } from "./saucer";
import { rockById, toSim, type MutBullet, type Sim } from "./sim";
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
  } | null;
  enemyBullets: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
  }[];
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
}

/** One pose: the state in, the state the pose left out. */
function pose(
  state: DeepReadonly<ShatterState>,
  act: (sim: Sim) => void,
): ShatterState {
  const sim = toSim(state);
  act(sim);
  return sim;
}

/** A round, as the snapshot reports one. */
function readBullet(bullet: DeepReadonly<MutBullet>): {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
} {
  return {
    id: bullet.id,
    x: bullet.x,
    y: bullet.y,
    vx: bullet.vx,
    vy: bullet.vy,
    life: bullet.life,
  };
}

/** Build the surface. It holds nothing; every operation is over the state. */
export function createDebugApi(): ShatterDebugApi {
  return {
    version: SHATTER_DEBUG_VERSION,

    reset: (state, options) =>
      pose(state, (sim) => {
        resetToTitle(sim, options?.seed ?? DEFAULT_SEED);
      }),

    // Where the build laid the entry out, which `specs/ui.md` leaves to the
    // build and a pointer check has to be told (`specs/instrumentation.md`).
    menuItemRect: (state, index) => menuItemRect(state.screen, index),

    snapshot: (state) => {
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
        bullets: state.bullets.map(readBullet),
        rocks: state.rocks.map((rock) => ({
          id: rock.id,
          x: rock.x,
          y: rock.y,
          vx: rock.vx,
          vy: rock.vy,
          size: rock.size,
          radius: rockRadius(rock.size),
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
              },
        enemyBullets: state.enemyBullets.map(readBullet),
        simTime: state.simTime,
      };
    },

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
        // A precondition, not a payment: the extra ship belongs to the scoring
        // path, so setting the score across a multiple grants nothing.
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

    setWaveSpawning: (state, enabled) =>
      pose(state, (sim) => {
        sim.waveSpawning = enabled;
      }),
    setSaucerSpawning: (state, enabled) =>
      pose(state, (sim) => {
        sim.saucerSpawning = enabled;
      }),

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

    addBullet: (state, x, y, vx, vy) =>
      pose(state, (sim) => {
        addBullet(sim, x, y, vx, vy);
      }),
    removeBullet: (state, id) =>
      pose(state, (sim) => {
        sim.bullets = sim.bullets.filter((bullet) => bullet.id !== id);
      }),
    clearBullets: (state) =>
      pose(state, (sim) => {
        sim.bullets = [];
      }),
    addEnemyBullet: (state, x, y, vx, vy) =>
      pose(state, (sim) => {
        addEnemyBullet(sim, x, y, vx, vy);
      }),
    removeEnemyBullet: (state, id) =>
      pose(state, (sim) => {
        sim.enemyBullets = sim.enemyBullets.filter(
          (bullet) => bullet.id !== id,
        );
      }),
    clearEnemyBullets: (state) =>
      pose(state, (sim) => {
        sim.enemyBullets = [];
      }),

    addRock: (state, size, x, y) =>
      pose(state, (sim) => {
        addRock(sim, size, x, y, 0, 0);
      }),
    setRockVelocity: (state, id, vx, vy) =>
      pose(state, (sim) => {
        const rock = rockById(sim, id);
        if (rock === undefined) return;
        rock.vx = vx;
        rock.vy = vy;
      }),
    removeRock: (state, id) =>
      pose(state, (sim) => {
        sim.rocks = sim.rocks.filter((rock) => rock.id !== id);
      }),
    clearRocks: (state) =>
      pose(state, (sim) => {
        // A removal, not a destruction: nothing scores, nothing splits, and no
        // rock has been destroyed on the tick this leaves the field empty on.
        sim.rocks = [];
      }),

    addSaucer: (state, x, y) =>
      pose(state, (sim) => {
        addSaucer(sim, x, y);
      }),
    setSaucerVelocity: (state, vx, vy) =>
      pose(state, (sim) => {
        if (sim.saucer === null) return;
        sim.saucer.vx = vx;
        sim.saucer.vy = vy;
      }),
    removeSaucer: (state) =>
      pose(state, (sim) => {
        sim.saucer = null;
      }),
    setSaucerMind: (state, enabled) =>
      pose(state, (sim) => {
        if (sim.saucer === null) return;
        sim.saucer.mind = enabled;
      }),
    setSaucerGun: (state, enabled) =>
      pose(state, (sim) => {
        if (sim.saucer === null) return;
        sim.saucer.gun = enabled;
      }),
    setSaucerTravel: (state, enabled) =>
      pose(state, (sim) => {
        if (sim.saucer === null) return;
        sim.saucer.travel = enabled;
      }),
  };
}
