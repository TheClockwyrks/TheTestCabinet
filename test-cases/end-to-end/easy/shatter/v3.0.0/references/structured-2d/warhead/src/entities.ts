// Shatter — putting a body on the field.
//
// Every entity takes a fresh id from the state's own counter, distinct among the
// entities live at that moment and not reused while any live entity holds it
// (`specs/state.md`), and is APPENDED to its roster — which is what makes an id
// findable without an assignment scheme: an entity added through the debug
// surface is the last entry (`specs/instrumentation.md`).
//
// These constructors are the one route onto the field. Play reaches them and so
// does the debug surface, so a body posed from code is the same body the game
// would have produced.

import {
  BULLET_LIFE,
  ROCK_HEALTH,
  SAUCER_BULLET_LIFE,
  SAUCER_FIRE_INTERVAL,
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  TORPEDO_LIFE,
  TORPEDO_SPEED,
  type RockSize,
} from "./constants";
import type {
  BulletState,
  RockState,
  SaucerState,
  ShatterState,
  TorpedoState,
} from "./game";
import { wrapX, wrapY } from "./geometry";
import { nextAngle } from "./rng";

/** The next id, distinct among every entity live at this moment. */
export function takeId(state: ShatterState): number {
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

/**
 * A rock of `size`, at rest, at full health for its size.
 *
 * The spin it is drawn with is the build's own, drawn from its own source.
 */
export function addRockTo(
  state: ShatterState,
  size: RockSize,
  x: number,
  y: number,
): RockState {
  const rock: RockState = {
    id: takeId(state),
    x: wrapX(x),
    y: wrapY(y),
    vx: 0,
    vy: 0,
    size,
    spin: nextAngle(),
    health: ROCK_HEALTH[size],
    flash: 0,
  };
  state.rocks.push(rock);
  return rock;
}

/** One of the ship's bullets in flight, with a full lifetime. */
export function addBulletTo(
  state: ShatterState,
  x: number,
  y: number,
  vx: number,
  vy: number,
): BulletState {
  const bullet: BulletState = {
    id: takeId(state),
    x: wrapX(x),
    y: wrapY(y),
    vx,
    vy,
    life: BULLET_LIFE,
  };
  state.bullets.push(bullet);
  return bullet;
}

/** One saucer bullet in flight, with a full lifetime. */
export function addEnemyBulletTo(
  state: ShatterState,
  x: number,
  y: number,
  vx: number,
  vy: number,
): BulletState {
  const bullet: BulletState = {
    id: takeId(state),
    x: wrapX(x),
    y: wrapY(y),
    vx,
    vy,
    life: SAUCER_BULLET_LIFE,
  };
  state.enemyBullets.push(bullet);
  return bullet;
}

/** One torpedo in flight along `heading`, guidance on, with a full lifetime. */
export function addTorpedoTo(
  state: ShatterState,
  x: number,
  y: number,
  heading: number,
): TorpedoState {
  const torpedo: TorpedoState = {
    id: takeId(state),
    x: wrapX(x),
    y: wrapY(y),
    vx: Math.cos(heading) * TORPEDO_SPEED,
    vy: Math.sin(heading) * TORPEDO_SPEED,
    heading,
    life: TORPEDO_LIFE,
    homing: true,
  };
  state.torpedoes.push(torpedo);
  return torpedo;
}

/**
 * A saucer on the field, travelling right at cruise with no vertical component,
 * its clocks at a full interval each, its own lifetime clock at zero, and all
 * three faculties on. It replaces any saucer already up, since at most one is on
 * the field at a time.
 */
export function addSaucerTo(
  state: ShatterState,
  x: number,
  y: number,
): SaucerState {
  const saucer: SaucerState = {
    id: takeId(state),
    x: wrapX(x),
    y: wrapY(y),
    vx: SAUCER_SPEED,
    vy: 0,
    mind: true,
    gun: true,
    travel: true,
    // Down, for a saucer posed onto the field; an arrival draws its own.
    weave: 1,
    fireClock: SAUCER_FIRE_INTERVAL,
    weaveClock: SAUCER_WEAVE_INTERVAL,
    age: 0,
  };
  state.saucer = saucer;
  return saucer;
}
