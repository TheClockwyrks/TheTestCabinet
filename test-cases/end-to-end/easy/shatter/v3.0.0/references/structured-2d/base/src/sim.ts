// Shatter — the simulation: the fixed step the frame is converted into, and the
// order of work inside one tick.
//
// The engine measures how much real time each frame covers and hands the game
// that delta in seconds; it imposes no timestep of its own. `specs/simulation.md`
// fixes Shatter's, so the delta is accumulated in the state and whole ticks are
// run from it with the remainder carried into the next frame. Nothing runs on a
// frame the accumulator does not hold a whole tick for, so a scripted caller
// that advances no frames advances no game.
//
// One tick runs the order the specification states, and the order matters
// because a figure a check reads rests on it:
//
//   1. Control forces — the ship's facing turns and its thrust is taken along
//      it, and the saucer steers.
//   2. The gravity acceleration, for every pulled body.
//   3. Velocity — each body's velocity gains both accelerations over TICK_DT,
//      and the ship's drag and speed cap are then applied to its velocity.
//   4. Position — each body advances by its velocity over TICK_DT.
//   5. The wrap, bringing every position back into the field.
//   6. Collision resolution.
//
// The timers each count down by TICK_DT on the tick they run in. The respawn
// grace and the gun's gate are counted down at the TOP of the tick, because
// both decide what this tick's collision and this tick's gun may do: lethal
// contact resumes on the tick the grace reaches zero.

import {
  FIRE_INTERVAL_TICKS,
  MAX_BULLETS,
  MUZZLE_SPEED,
  SHIP_R,
  TICK_DT,
} from "./constants";
import type { FrameCues } from "./audio";
import { resolveCollisions, type Moving, type TickPrev } from "./collision";
import { addBulletTo } from "./entities";
import { wrapX, wrapY } from "./geometry";
import type { BulletState, ShatterState } from "./game";
import { gravityAccel } from "./gravity";
import { advanceSpins } from "./rocks";
import { keepSaucerClearOfCore, runSaucerSystems, steerSaucer } from "./saucer";
import { settleShipVelocity, shipControlForces } from "./ship";
import { runWaveLoop } from "./waves";

/**
 * How many ticks one frame may be worth. A frame that arrives after a long
 * stall costs the game a pause rather than a burst of simulation.
 */
const MAX_TICKS_PER_FRAME = 30;

/**
 * How far ahead of the ship's centre a round is launched, along its facing.
 *
 * `specs/weapons.md` puts the launch at the nose and no further from the centre
 * than `SHIP_R`, and the round travels from there at the muzzle speed, so the
 * offset leaves room for the travel of the first ticks that follow.
 */
const MUZZLE_OFFSET = SHIP_R * 0.55;

/** Advance a roster's lifetimes by one tick, dropping what has expired. */
function advanceLifetimes(roster: BulletState[]): BulletState[] {
  const alive: BulletState[] = [];
  for (const entry of roster) {
    entry.life -= TICK_DT;
    if (entry.life > 0) alive.push(entry);
  }
  return alive;
}

/** Every body's start-of-tick reading, for the swept contact tests. */
function readTickStart(state: ShatterState): TickPrev {
  const bodies = new Map<number, Moving>();
  const record = (body: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }): void => {
    bodies.set(body.id, { x: body.x, y: body.y, vx: body.vx, vy: body.vy });
  };

  for (const bullet of state.bullets) record(bullet);
  for (const bullet of state.enemyBullets) record(bullet);
  for (const rock of state.rocks) record(rock);

  const ship = state.ship;
  const saucer = state.saucer;
  return {
    ship: { x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy },
    saucer:
      saucer === null
        ? null
        : { x: saucer.x, y: saucer.y, vx: saucer.vx, vy: saucer.vy },
    bodies,
  };
}

/** The gun: one round per press, and one every `FIRE_INTERVAL_TICKS` held. */
function runGun(state: ShatterState, cues: FrameCues): void {
  const ship = state.ship;
  if (!state.input.fire) return;
  if (ship.fireCooldown > 0) return;
  if (state.bullets.length >= MAX_BULLETS) return;

  const cos = Math.cos(ship.angle);
  const sin = Math.sin(ship.angle);
  addBulletTo(
    state,
    ship.x + cos * MUZZLE_OFFSET,
    ship.y + sin * MUZZLE_OFFSET,
    ship.vx + cos * MUZZLE_SPEED,
    ship.vy + sin * MUZZLE_SPEED,
  );
  ship.fireCooldown = FIRE_INTERVAL_TICKS;
  cues.fire = true;
}

/** One whole tick of `TICK_DT`, the only unit the simulation advances in. */
export function runTick(state: ShatterState, cues: FrameCues): void {
  // Accumulated on every screen, which is what makes it the game's own clock
  // rather than the play clock (`specs/instrumentation.md`).
  state.simTime += TICK_DT;
  if (state.screen !== "playing") return;

  const ship = state.ship;
  if (ship.invuln > 0) ship.invuln = Math.max(0, ship.invuln - TICK_DT);
  if (ship.fireCooldown > 0)
    ship.fireCooldown = Math.max(0, ship.fireCooldown - 1);
  if (state.extraLifeNotice > 0) {
    state.extraLifeNotice = Math.max(0, state.extraLifeNotice - TICK_DT);
  }

  // 1. Control forces.
  const thrust = shipControlForces(state);
  steerSaucer(state);

  // 2 and 3. The well, then the velocities — the ship's settled by its own drag
  // and speed cap, and the powered craft untouched by the well.
  ship.vx += thrust.ax * TICK_DT;
  ship.vy += thrust.ay * TICK_DT;
  settleShipVelocity(ship);

  for (const body of [
    ...state.bullets,
    ...state.enemyBullets,
    ...state.rocks,
  ]) {
    const pull = gravityAccel(body.x, body.y);
    body.vx += pull.ax * TICK_DT;
    body.vy += pull.ay * TICK_DT;
  }

  // 4 and 5. Position and the wrap, from the readings the sweep measures from.
  const prev = readTickStart(state);

  ship.x = wrapX(ship.x + ship.vx * TICK_DT);
  ship.y = wrapY(ship.y + ship.vy * TICK_DT);

  for (const body of [
    ...state.bullets,
    ...state.enemyBullets,
    ...state.rocks,
  ]) {
    body.x = wrapX(body.x + body.vx * TICK_DT);
    body.y = wrapY(body.y + body.vy * TICK_DT);
  }

  const saucer = state.saucer;
  if (saucer !== null && saucer.travel) {
    saucer.x = wrapX(saucer.x + saucer.vx * TICK_DT);
    saucer.y = wrapY(saucer.y + saucer.vy * TICK_DT);
    keepSaucerClearOfCore(saucer);
  }

  // 6. Collision resolution.
  const destroyed = resolveCollisions(state, prev, cues);

  // The clocks and the game's own systems, from the field this tick settled on.
  state.bullets = advanceLifetimes(state.bullets);
  state.enemyBullets = advanceLifetimes(state.enemyBullets);
  advanceSpins(state);
  runSaucerSystems(state, cues);
  runWaveLoop(state, destroyed);

  // The gun last, so the round it takes leaves at the muzzle speed from the
  // nose rather than a tick's travel ahead of it.
  if (state.screen === "playing") runGun(state, cues);
}

/**
 * One frame: the delta the engine measured, converted into whole ticks with the
 * remainder carried.
 */
export function advanceFrame(
  state: ShatterState,
  dt: number,
  cues: FrameCues,
): void {
  if (!(dt > 0)) return;
  state.tickClock += dt;

  let ticks = 0;
  while (state.tickClock >= TICK_DT - 1e-9 && ticks < MAX_TICKS_PER_FRAME) {
    state.tickClock -= TICK_DT;
    runTick(state, cues);
    ticks += 1;
  }

  if (ticks >= MAX_TICKS_PER_FRAME) state.tickClock = 0;
}
