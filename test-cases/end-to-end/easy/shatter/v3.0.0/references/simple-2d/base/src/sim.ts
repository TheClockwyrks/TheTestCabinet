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
// The copy is deep down to the entities: the ship, every rock, every bullet,
// every saucer bullet and the saucer are rebuilt, so a frame can rewrite one
// without the state it came from noticing.
//
// Writing the frame this way rather than as a chain of spreads is what keeps the
// rules readable as the rules — `rock.vx += ax * TICK_DT` is the sentence
// `specs/simulation.md` writes — while the immutability the engine requires is
// enforced at the one boundary where it matters: the state handed in and the
// state handed back.

import type { CueName, RockSize } from "./constants";
import type { Screen, ShatterState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/**
 * What one TICK produced beside the state it advanced.
 *
 * Cues are gathered rather than played as they happen, so a tick that raises one
 * twice still plays it once, which is what `specs/audio.md` asks for.
 * `rocksDestroyed` is what the wave-clear rule reads: `specs/progression.md`
 * makes a clear the TICK in which the last rock on the field is destroyed, so a
 * field that holds no rocks and has had none destroyed on that tick is a wave
 * being played rather than a wave cleared. That is a fact about the tick rather
 * than about the field, so it lives here.
 */
export interface TickEvents {
  readonly cues: Set<CueName>;
  rocksDestroyed: number;
}

/** A fresh record of what a tick produced. */
export function newTickEvents(): TickEvents {
  return { cues: new Set<CueName>(), rocksDestroyed: 0 };
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

  waveSpawning: boolean;
  saucerSpawning: boolean;
  saucerClock: number;
  saucerDue: number;

  tickClock: number;
  nextId: number;
  simTime: number;
  muted: boolean;
  rngState: number;

  extraLifeNotice: number;
}

/** Copy the state handed in into a value this transition may write. */
export function toSim(state: DeepReadonly<ShatterState>): Sim {
  const saucer = state.saucer;
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
    rocks: state.rocks.map((rock) => ({
      id: rock.id,
      x: rock.x,
      y: rock.y,
      vx: rock.vx,
      vy: rock.vy,
      size: rock.size,
      spin: rock.spin,
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
    enemyBullets: state.enemyBullets.map(copyBullet),

    waveSpawning: state.waveSpawning,
    saucerSpawning: state.saucerSpawning,
    saucerClock: state.saucerClock,
    saucerDue: state.saucerDue,

    tickClock: state.tickClock,
    nextId: state.nextId,
    simTime: state.simTime,
    muted: state.muted,
    rngState: state.rngState,

    extraLifeNotice: state.extraLifeNotice,
  };
}

function copyBullet(bullet: DeepReadonly<MutBullet>): MutBullet {
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
 * The id the next rock, bullet, saucer bullet or saucer takes.
 *
 * `specs/instrumentation.md` requires only that an id is distinct among the
 * entities live at one moment; one counter across every roster gives that, and
 * a counter that never goes backwards keeps an id stable for as long as its
 * entity exists and never reuses one while a live entity holds it.
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

/**
 * A timer counted down by one tick, landing exactly on zero.
 *
 * Every timer in the game is a whole number of ticks of a stated duration —
 * 180 ticks of a 1.5 second banner, 300 of a 2.5 second grace — and the
 * accumulated rounding of that many subtractions leaves a residue far below the
 * tolerance below, so a timer expires on the tick the specification says it
 * does rather than one after.
 */
export function countDown(seconds: number, dt: number): number {
  const next = seconds - dt;
  return next <= 1e-9 ? 0 : next;
}
