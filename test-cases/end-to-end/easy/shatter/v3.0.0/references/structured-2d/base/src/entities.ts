// Shatter — putting a body on the field.
//
// Every roster entry the game or the debug surface creates is created here, so
// the two identity rules `specs/instrumentation.md` states hold whichever route
// it arrived by: an entity is APPENDED to its roster, so it is the last entry
// and its id is read from there, and every id is distinct among the entities
// live at that moment and is not reused while any live entity holds it.
//
// `nextId` is the whole of the assignment scheme, and it lives on the state, so
// a reset restarts identity with the rest of the game.

import {
  BULLET_LIFE,
  SAUCER_BULLET_LIFE,
  SAUCER_FIRE_INTERVAL,
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  type RockSize,
} from "./constants";
import { wrapX, wrapY } from "./geometry";
import type { BulletState, RockState, SaucerState, ShatterState } from "./game";
import { random } from "./rng";

/** The id the next entity takes. No live entity ever holds it already. */
export function takeId(state: ShatterState): number {
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

/**
 * One rock of `size`, centred at a field position and AT REST, appended to the
 * roster with a fresh id and the collision radius its size fixes.
 *
 * At rest rather than at a drift speed: the pose is then the caller's alone,
 * and a rock at rest is a legal state the well immediately begins to act on.
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
    spin: random(state) * Math.PI * 2,
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

/**
 * A saucer on the field, travelling at cruise with no vertical component, its
 * clocks at the start of their intervals and all three faculties on.
 *
 * There is one slot, so this replaces any saucer already up — and the arrival
 * takes a fresh id, which is what makes one visit distinguishable from the
 * next.
 */
export function addSaucerTo(
  state: ShatterState,
  x: number,
  y: number,
  vx = SAUCER_SPEED,
): SaucerState {
  const saucer: SaucerState = {
    id: takeId(state),
    x: wrapX(x),
    y: wrapY(y),
    vx,
    vy: 0,
    mind: true,
    gun: true,
    travel: true,
    fireClock: SAUCER_FIRE_INTERVAL,
    weaveClock: SAUCER_WEAVE_INTERVAL,
    age: 0,
  };
  state.saucer = saucer;
  return saucer;
}
