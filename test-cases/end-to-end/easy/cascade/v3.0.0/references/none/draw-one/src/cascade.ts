// Cascade — the victory cascade (`specs/victory.md`).
//
// Every card on the foundations launches in turn, arcs under gravity, bounces
// along the floor, paints itself onto the persistent layer, and drifts off a
// side edge. The whole of it is integrated against the frame's delta, so the
// simulation reads nothing from the renderer and advances on elapsed game time
// alone.
//
// THE ORDER WITHIN A FRAME IS FIXED, and the checks read it: every card in
// flight is advanced first, in order, by gravity, then the advance, then the
// floor bounce, then the stamp, then the retirement — and only then does the
// launch clock take the frame's delta and launch whatever it has earned.
//
// THE LAUNCH CLOCK CARRIES ITS REMAINDER, so the cadence does not drift and a
// frame long enough to cover several intervals launches several cards. After
// `t` seconds of a running cascade exactly `floor(t / LAUNCH_INTERVAL) + 1`
// cards have launched.

import {
  BOUNCE_DAMP,
  CARD_W,
  CUES,
  DECK_SIZE,
  FLOOR_Y,
  FOUNDATION_COUNT,
  FOUNDATION_X,
  GRAVITY,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  LAUNCH_VY,
  STAGE_W,
  TOP_ROW_Y,
} from "./constants";
import { drawCardOn } from "./cards";
import { nextFloat } from "./rng";
import type { CascadeState } from "./state";
import type { Card, Flyer } from "./types";

/** Put one card in flight, appended to the flight with a fresh id. */
export function addFlyer(
  state: CascadeState,
  suit: Flyer["suit"],
  rank: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Flyer {
  const flyer: Flyer = { id: state.nextId, suit, rank, x, y, vx, vy };
  state.nextId += 1;
  state.flyers.push(flyer);
  return flyer;
}

/** Stamp one card onto the painted layer at its position, and count the stamp. */
export function stampTrail(state: CascadeState, flyer: Flyer): void {
  state.trailStamps += 1;
  const trail = state.trail;
  if (trail === null) return;
  const card: Card = {
    id: flyer.id,
    suit: flyer.suit,
    rank: flyer.rank,
    faceUp: true,
  };
  drawCardOn(trail.ctx, card, flyer.x, flyer.y);
}

/**
 * Advance every card in flight by one frame.
 *
 * Runs whatever the screen, because a card put in flight through the debug
 * surface flies by the game's own rules wherever it was posed.
 */
export function advanceFlyers(state: CascadeState, dt: number): void {
  if (state.flyers.length === 0) return;
  const surviving: Flyer[] = [];
  for (const flyer of state.flyers) {
    flyer.vy += GRAVITY * dt;
    flyer.x += flyer.vx * dt;
    flyer.y += flyer.vy * dt;
    if (flyer.y >= FLOOR_Y && flyer.vy > 0) {
      flyer.vy = -flyer.vy * BOUNCE_DAMP;
      flyer.y = FLOOR_Y;
    }
    if (state.trailPainting) stampTrail(state, flyer);
    // A card collides with nothing, so only clearing a side edge retires it.
    const retired = flyer.x + CARD_W < 0 || flyer.x > STAGE_W;
    if (!retired) surviving.push(flyer);
  }
  state.flyers.length = 0;
  state.flyers.push(...surviving);
}

/**
 * One launch's `vx`: a magnitude drawn uniformly from its range and a sign
 * chosen with equal probability, each afresh at the call.
 */
export function drawLaunchVx(): number {
  const magnitude =
    LAUNCH_VX_MIN + nextFloat() * (LAUNCH_VX_MAX - LAUNCH_VX_MIN);
  const sign = nextFloat() < 0.5 ? -1 : 1;
  return sign * magnitude;
}

/**
 * Launch the next card: the current top card of the foundation whose turn it
 * is, skipping a foundation that has been emptied.
 *
 * Reports whether a card left the foundations.
 */
export function launchNext(state: CascadeState): boolean {
  for (let step = 0; step < FOUNDATION_COUNT; step += 1) {
    const index = (state.nextFoundation + step) % FOUNDATION_COUNT;
    const foundation = state.foundations[index];
    const card = foundation.pop();
    if (card === undefined) continue;
    const flyer: Flyer = {
      // A card that launches keeps the id it carried on the table.
      id: card.id,
      suit: card.suit,
      rank: card.rank,
      x: FOUNDATION_X[index],
      y: TOP_ROW_Y,
      vx: drawLaunchVx(),
      vy: LAUNCH_VY,
    };
    state.flyers.push(flyer);
    state.nextFoundation = (index + 1) % FOUNDATION_COUNT;
    state.launched += 1;
    state.cues.raise(CUES.launch);
    return true;
  }
  return false;
}

/** Whether any foundation still holds a card the cascade could launch. */
export function hasLaunchable(state: CascadeState): boolean {
  return state.foundations.some((foundation) => foundation.length > 0);
}

/**
 * One frame of the cascade: the cards in flight, then the launch clock.
 *
 * A card launched in a frame takes no motion in that frame, because the
 * launches follow the integration — which is what makes the first flyer's
 * position and velocity readable one frame after the win.
 */
export function updateCascade(state: CascadeState, dt: number): void {
  advanceFlyers(state, dt);
  if (state.screen !== "won") return;
  if (state.launching) {
    state.launchClock += dt;
    // The clock is only spent on a card that actually launches, so a cascade
    // whose foundations are empty simply accumulates rather than eating its
    // own remainder.
    while (state.launchClock >= LAUNCH_INTERVAL && hasLaunchable(state)) {
      state.launchClock -= LAUNCH_INTERVAL;
      launchNext(state);
    }
  }
  if (state.launched >= DECK_SIZE && state.flyers.length === 0) {
    state.cascadeDone = true;
  }
}
