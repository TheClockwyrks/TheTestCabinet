// Shatter — the homing torpedo: its guidance, its flight, and its charge.
//
// A torpedo is a powered craft, so `specs/gravity.md` keeps the well off it
// entirely: it holds the course it is steering straight through the gravity the
// star exerts. Its guidance looks FORWARD alone — a body behind it is never
// acquired — and it re-evaluates every tick, so it acquires, loses and
// re-acquires targets over its flight.

import {
  TICK_DT,
  TORPEDO_CONE,
  TORPEDO_RECHARGE,
  TORPEDO_SPEED,
  TORPEDO_TURN,
} from "./constants";
import type { ShatterState, TorpedoState } from "./game";
import { deltaX, deltaY, normalizeAngle, wrapX, wrapY } from "./geometry";
import { recordMove, type Positioned, type MoveTable } from "./motion";

/**
 * The nearest body inside a torpedo's forward cone, or `null` for none.
 *
 * A candidate is a rock or the saucer whose bearing from the torpedo lies within
 * `TORPEDO_CONE` of the torpedo's current heading on either side, and the
 * nearest of them by shortest wrapped distance wins.
 */
export function acquireTarget(
  state: ShatterState,
  torpedo: TorpedoState,
): Positioned | null {
  let best: Positioned | null = null;
  let bestDistance = Infinity;

  const consider = (body: Positioned): void => {
    const dx = deltaX(torpedo.x, body.x);
    const dy = deltaY(torpedo.y, body.y);
    const distance = Math.hypot(dx, dy);
    if (distance === 0 || distance >= bestDistance) return;
    const off = Math.abs(normalizeAngle(Math.atan2(dy, dx) - torpedo.heading));
    if (off > TORPEDO_CONE) return;
    best = body;
    bestDistance = distance;
  };

  for (const rock of state.rocks) consider(rock);
  if (state.saucer !== null) consider(state.saucer);
  return best;
}

/** Step 1 of the tick for a torpedo: the turn its guidance asks for. */
export function guideTorpedoes(state: ShatterState): void {
  for (const torpedo of state.torpedoes) {
    if (torpedo.homing) {
      const target = acquireTarget(state, torpedo);
      if (target !== null) {
        const bearing = Math.atan2(
          deltaY(torpedo.y, target.y),
          deltaX(torpedo.x, target.x),
        );
        const error = normalizeAngle(bearing - torpedo.heading);
        const step = TORPEDO_TURN * TICK_DT;
        torpedo.heading += Math.max(-step, Math.min(step, error));
      }
    }

    // The speed is held whether or not it is turning, so the velocity is the
    // heading at that speed and nothing else.
    const speed = Math.hypot(torpedo.vx, torpedo.vy) || TORPEDO_SPEED;
    torpedo.vx = Math.cos(torpedo.heading) * speed;
    torpedo.vy = Math.sin(torpedo.heading) * speed;
  }
}

/** Steps 4 and 5 for a torpedo: its lifetime, its move, and the wrap. */
export function integrateTorpedoes(
  state: ShatterState,
  moves: MoveTable,
): void {
  for (let index = state.torpedoes.length - 1; index >= 0; index -= 1) {
    const torpedo = state.torpedoes[index];
    torpedo.life -= TICK_DT;
    if (torpedo.life <= 0) {
      state.torpedoes.splice(index, 1);
      continue;
    }

    const mx = torpedo.vx * TICK_DT;
    const my = torpedo.vy * TICK_DT;
    torpedo.x = wrapX(torpedo.x + mx);
    torpedo.y = wrapY(torpedo.y + my);
    recordMove(moves, torpedo, mx, my);
  }
}

/** The charge rising linearly from `0` to `1` over `TORPEDO_RECHARGE`. */
export function advanceTorpedoCharge(state: ShatterState): void {
  if (state.torpedoCharge >= 1) return;
  state.torpedoCharge = Math.min(
    1,
    state.torpedoCharge + TICK_DT / TORPEDO_RECHARGE,
  );
}
