// Shatter — the simulation one frame owes the game.
//
// The engine hands each frame the real elapsed seconds it measured and imposes
// no timestep of its own. `specs/simulation.md` fixes Shatter's at `TICK_HZ`, so
// the delta is accumulated in the state and run off in whole ticks, with the
// remainder carried into the next frame — which is what makes an interval of
// game time reach the same state however it was divided into frames.
//
// One tick runs the order the specification fixes:
//
//   1. Control forces — the ship's facing and burn, the saucer's steering, and
//      the turn a torpedo's guidance asks for.
//   2. The gravity acceleration from the star, for every pulled body.
//   3. Velocity, with the ship's drag and speed cap applied after its thrust.
//   4. Position.
//   5. The wrap.
//   6. Collision resolution.
//
// Steps 2 to 5 are one pass per kind of body, since a body's pull, its move and
// its wrap are the same three lines wherever they are written. What follows the
// six is the game's own bookkeeping: the weapons that leave the nose, the
// saucer's gun, the wave loop and the arrival cadence.

import type { FrameCues } from "./audio";
import { TICK_DT } from "./constants";
import { integrateBullets } from "./bullets";
import { resolveCollisions } from "./collision";
import type { ShatterState } from "./game";
import type { MoveTable } from "./motion";
import { integrateRocks } from "./rocks";
import {
  advanceSaucerCadence,
  fireSaucerGun,
  integrateSaucer,
  steerSaucer,
} from "./saucer";
import { controlShip, fireGun, integrateShip, launchTorpedo } from "./ship";
import {
  advanceTorpedoCharge,
  guideTorpedoes,
  integrateTorpedoes,
} from "./torpedoes";
import { MAX_TICKS_PER_FRAME, TICK_EPSILON } from "./tuning";
import { advanceWaves } from "./waves";

/** Every timer the game keeps counts down by `TICK_DT` on the tick it runs in. */
function advanceTimers(state: ShatterState): void {
  const ship = state.ship;
  if (ship.invuln > 0) ship.invuln = Math.max(0, ship.invuln - TICK_DT);
  if (ship.fireCooldown > 0)
    ship.fireCooldown = Math.max(0, ship.fireCooldown - 1);
  if (state.extraFlash > 0) {
    state.extraFlash = Math.max(0, state.extraFlash - TICK_DT);
  }
  for (const rock of state.rocks) {
    if (rock.flash > 0) rock.flash = Math.max(0, rock.flash - TICK_DT);
  }
  advanceTorpedoCharge(state);
}

/** One whole tick of `TICK_DT` seconds of game time. */
export function runTick(state: ShatterState, cues: FrameCues): void {
  // Accumulated on every screen, which is what makes it the game's own clock
  // rather than the play clock: it counts the ticks the game ran.
  state.simTime += TICK_DT;

  if (state.screen !== "playing") {
    state.ship.thrusting = false;
    return;
  }

  advanceTimers(state);

  // 1. Control forces.
  controlShip(state);
  steerSaucer(state);
  guideTorpedoes(state);

  // 2 to 5. The pull, the velocity it and the burn leave, the move, the wrap.
  const moves: MoveTable = new Map();
  integrateShip(state, moves);
  integrateBullets(state, moves);
  integrateRocks(state, moves);
  integrateTorpedoes(state, moves);
  integrateSaucer(state, moves);

  // What leaves a body this tick leaves it where the body now stands, so a round
  // is at the nose on the tick it is fired and travels from there on the next.
  fireGun(state, cues);
  launchTorpedo(state);
  fireSaucerGun(state);

  // 6. Collision resolution.
  const destroyed = resolveCollisions(state, moves, cues);

  advanceWaves(state, destroyed);
  advanceSaucerCadence(state, cues);
}

/**
 * Advance the whole game by the frame's `dt`, in whole ticks, collecting the
 * cues the frame raised.
 *
 * A frame that brings less than a tick's worth of time runs none, and one that
 * brings several runs each of them; a frame worth more than `MAX_TICKS_PER_FRAME`
 * — a tab that stopped receiving frames — drops the rest rather than freezing
 * the page catching up.
 */
export function advanceGame(
  state: ShatterState,
  dt: number,
  cues: FrameCues,
): void {
  state.tickClock += dt;

  let ticks = 0;
  while (state.tickClock >= TICK_DT - TICK_EPSILON) {
    if (ticks >= MAX_TICKS_PER_FRAME) {
      state.tickClock = 0;
      break;
    }
    state.tickClock -= TICK_DT;
    runTick(state, cues);
    ticks += 1;
  }

  // The held cue follows the state the frame's ticks left, so it sounds while
  // thrust is applied and stops within a tick of it being released.
  cues.thrust = state.ship.thrusting;
}
