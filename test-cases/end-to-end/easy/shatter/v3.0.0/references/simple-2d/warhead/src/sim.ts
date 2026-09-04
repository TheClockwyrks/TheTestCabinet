// Shatter — the working value a frame is built in.
//
// The engine holds the state by value and hands every reader a
// `DeepReadonly<ShatterState>` view, so nothing in this build ever writes to a
// state it was handed. What `update` and every debug pose do instead is COPY the
// state they were given into a `Sim` — a field-for-field mirror of
// `ShatterState` with the `readonly` markers dropped — advance that, and return
// it. TypeScript accepts the result as a `ShatterState` because a mutable field
// is assignable to a readonly one, so the copy costs a type assertion nowhere.
//
// The copy is deep down to the entities: every rock, bullet, torpedo and trail
// is rebuilt, so a frame can rewrite one without the state it came from
// noticing.
//
// Writing the frame this way rather than as a chain of spreads is what keeps the
// rules readable as the rules: `rock.health -= 1` is the sentence
// `specs/rocks.md` writes, and the immutability the engine requires is enforced
// at the one boundary where it matters, the state handed in and the state handed
// back.

import { nextInt, nextRandom, nextRange, nextSign } from "./rng";
import type { CueName, RockSize } from "./constants";
import type { BulletState, Screen, ShatterState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/**
 * What a frame produced beside the state it advanced.
 *
 * Cues are gathered rather than played as they happen, so a frame that raises
 * one twice still plays it once. `thrusting` is separate because the thrust cue
 * is held rather than struck.
 *
 * `rocksDestroyed` is what the wave-clear rule reads: `specs/progression.md`
 * makes a clear the TICK IN WHICH the last rock is destroyed, so a field that
 * holds no rocks and has had none destroyed on that tick is a wave being played
 * rather than a wave cleared. That is a fact about the tick, not about the
 * field, so it lives here.
 */
export interface FrameEvents {
  readonly cues: Set<CueName>;
  rocksDestroyed: number;
  thrusting: boolean;
}

/** A fresh record of what a frame produced. */
export function newFrameEvents(): FrameEvents {
  return { cues: new Set<CueName>(), rocksDestroyed: 0, thrusting: false };
}

export interface MutShip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  thrusting: boolean;
  invuln: number;
  collision: boolean;
  fireCooldown: number;
}

export interface MutBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface MutRock {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  spin: number;
  health: number;
  flash: number;
}

export interface MutSaucer {
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

export interface MutTorpedo {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  life: number;
  homing: boolean;
}

/** How far one body actually moved over a tick, before the wrap. */
export interface Move {
  mx: number;
  my: number;
}

/** A body that did not move at all this tick. */
export const NO_MOVE: Move = { mx: 0, my: 0 };

/**
 * What every body's position step came to, so the collision step can sweep.
 *
 * `specs/collision.md` requires collision that is swept or continuous, which
 * needs where each body WAS as well as where it ended. Recording the movement
 * rather than the old position is what makes that survive the wrap: a body that
 * crossed a seam has a position that jumped a field width, and its movement is
 * still the tick of travel it actually made.
 */
export interface Moves {
  ship: Move;
  saucer: Move;
  byId: Map<number, Move>;
}

/** How far the entity with that id moved this tick. */
export function moveOf(moves: Moves, id: number): Move {
  return moves.byId.get(id) ?? NO_MOVE;
}

export interface MutTrail {
  id: number;
  points: { dx: number; dy: number }[];
}

/** The whole of `ShatterState`, writable, for the length of one transition. */
export interface Sim {
  screen: Screen;
  menuIndex: number;

  score: number;
  lives: number;
  wave: number;
  waveBanner: number;

  ship: MutShip;
  bullets: MutBullet[];
  rocks: MutRock[];
  saucer: MutSaucer | null;
  enemyBullets: MutBullet[];
  torpedoes: MutTorpedo[];
  torpedoCharge: number;

  waveSpawning: boolean;
  saucerSpawning: boolean;
  saucerClock: number;
  saucerDue: number;

  tickClock: number;
  nextId: number;
  simTime: number;
  muted: boolean;
  rngState: number;

  trails: MutTrail[];
  extraLifeFlash: number;
}

function copyBullet(b: DeepReadonly<BulletState>): MutBullet {
  return { id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, life: b.life };
}

/** Copy the state handed in into a value this transition may write. */
export function toSim(state: DeepReadonly<ShatterState>): Sim {
  return {
    screen: state.screen,
    menuIndex: state.menuIndex,

    score: state.score,
    lives: state.lives,
    wave: state.wave,
    waveBanner: state.waveBanner,

    ship: {
      x: state.ship.x,
      y: state.ship.y,
      vx: state.ship.vx,
      vy: state.ship.vy,
      angle: state.ship.angle,
      thrusting: state.ship.thrusting,
      invuln: state.ship.invuln,
      collision: state.ship.collision,
      fireCooldown: state.ship.fireCooldown,
    },
    bullets: state.bullets.map(copyBullet),
    rocks: state.rocks.map((r) => ({
      id: r.id,
      x: r.x,
      y: r.y,
      vx: r.vx,
      vy: r.vy,
      size: r.size,
      spin: r.spin,
      health: r.health,
      flash: r.flash,
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
    enemyBullets: state.enemyBullets.map(copyBullet),
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

    waveSpawning: state.waveSpawning,
    saucerSpawning: state.saucerSpawning,
    saucerClock: state.saucerClock,
    saucerDue: state.saucerDue,

    tickClock: state.tickClock,
    nextId: state.nextId,
    simTime: state.simTime,
    muted: state.muted,
    rngState: state.rngState,

    trails: state.trails.map((t) => ({
      id: t.id,
      points: t.points.map((p) => ({ dx: p.dx, dy: p.dy })),
    })),
    extraLifeFlash: state.extraLifeFlash,
  };
}

/**
 * The id the next rock, bullet, saucer bullet or torpedo takes.
 *
 * `specs/instrumentation.md` requires only that an id is distinct among the
 * entities live at one moment; a counter that never goes backwards gives that
 * and makes an id stable for as long as its entity exists.
 */
export function takeId(sim: Sim): number {
  const id = sim.nextId;
  sim.nextId = id + 1;
  return id;
}

/** The rock with that id, or `undefined`. */
export function rockById(sim: Sim, id: number): MutRock | undefined {
  return sim.rocks.find((rock) => rock.id === id);
}

/** The torpedo with that id, or `undefined`. */
export function torpedoById(sim: Sim, id: number): MutTorpedo | undefined {
  return sim.torpedoes.find((torpedo) => torpedo.id === id);
}

// ---- Draws off the state's generator -------------------------------------
//
// Every one of them advances `rngState`, which is the whole of the generator, so
// a scenario reseeded by `reset({ seed })` replays exactly (`specs/simulation.md`).

/** A draw in `[0, 1)`. */
export function rand(sim: Sim): number {
  const [value, state] = nextRandom(sim.rngState);
  sim.rngState = state;
  return value;
}

/** A draw in `[lo, hi)`. */
export function randRange(sim: Sim, lo: number, hi: number): number {
  const [value, state] = nextRange(sim.rngState, lo, hi);
  sim.rngState = state;
  return value;
}

/** A whole draw in `[lo, hi]`. */
export function randInt(sim: Sim, lo: number, hi: number): number {
  const [value, state] = nextInt(sim.rngState, lo, hi);
  sim.rngState = state;
  return value;
}

/** A coin flip as a sign. */
export function randSign(sim: Sim): 1 | -1 {
  const [value, state] = nextSign(sim.rngState);
  sim.rngState = state;
  return value;
}
