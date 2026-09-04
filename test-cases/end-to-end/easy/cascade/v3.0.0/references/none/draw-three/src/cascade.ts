// Cascade — the victory cascade.
//
// specs/victory.md fixes this exactly, and the order of the five steps is part of
// the specification rather than an implementation detail: gravity, then the
// advance, then the floor bounce, then the stamp onto the painted layer, then the
// retirement. The launch clock is advanced AFTER every card in flight has been
// advanced, which is what makes a card launched in a frame take no motion in that
// frame, and is therefore what makes the launch position and the launch velocity
// assertable one frame after the win.
//
// EVERY RATE IS PER SECOND, integrated against the frame's delta. There is no
// fixed timestep anywhere in this build. Game time and anything integrated
// linearly against it are the same however an interval was divided into frames;
// a quantity under acceleration is not, and that is the correct behavior of the
// stated integration rather than something to be smoothed away.
//
// The launch clock CARRIES ITS REMAINDER, so the cadence does not drift and a
// frame long enough to cover several intervals launches several cards.

import {
  BOUNCE_DAMP,
  CARD_W,
  CUES,
  DECK_SIZE,
  FLOOR_Y,
  FOUNDATION_COUNT,
  GRAVITY,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  LAUNCH_VY,
  STAGE_W,
} from "./constants";
import { raiseCue } from "./audio";
import { anchorOf } from "./layout";
import { drawCardFace } from "./render";
import { nextBetween, nextSign } from "./rng";
import type { CascadeState, Flyer } from "./state";

/** Whether the cascade still has a card to launch. */
export function hasCardToLaunch(state: CascadeState): boolean {
  if (state.launched >= DECK_SIZE) return false;
  return state.foundations.some((pile) => pile.length > 0);
}

/** Stamp one card in flight onto the painted layer, at its position. */
export function stampFlyer(state: CascadeState, flyer: Flyer): void {
  state.trail.stamp(flyer.x, flyer.y, (ctx) => {
    drawCardFace(ctx, flyer.suit, flyer.rank, 0, 0);
  });
  state.trailStamps += 1;
}

/**
 * Advance every card in flight by one frame, in order.
 *
 * A card collides with nothing: not the side edges, not the piles beneath it, and
 * not another card in flight. The only thing it meets is the floor.
 */
export function advanceFlyers(state: CascadeState, dt: number): void {
  if (state.flyers.length === 0) return;
  const flying: Flyer[] = [];
  for (const flyer of state.flyers) {
    flyer.vy += GRAVITY * dt;
    flyer.x += flyer.vx * dt;
    flyer.y += flyer.vy * dt;
    if (flyer.y >= FLOOR_Y && flyer.vy > 0) {
      flyer.vy = -flyer.vy * BOUNCE_DAMP;
      flyer.y = FLOOR_Y;
    }
    if (state.trailPainting) stampFlyer(state, flyer);
    const retired = flyer.x + CARD_W < 0 || flyer.x > STAGE_W;
    if (!retired) flying.push(flyer);
  }
  state.flyers = flying;
}

/**
 * Launch the next card, and report whether one went.
 *
 * The order cycles the four foundations and skips one that has been emptied, so
 * each foundation walks its King down to its Ace and the cascade launches all
 * fifty-two cards. The launched card keeps its identity as a flyer.
 */
export function launchNext(state: CascadeState): boolean {
  for (let step = 0; step < FOUNDATION_COUNT; step += 1) {
    const slot = (state.launchCursor + step) % FOUNDATION_COUNT;
    const pile = state.foundations[slot];
    if (pile.length === 0) continue;
    const card = pile[pile.length - 1];
    pile.pop();
    const anchor = anchorOf("foundation", slot);
    const speed = nextBetween(state, LAUNCH_VX_MIN, LAUNCH_VX_MAX);
    const sign = nextSign(state);
    state.flyers.push({
      id: card.id,
      suit: card.suit,
      rank: card.rank,
      x: anchor.x,
      y: anchor.y,
      vx: speed * sign,
      vy: LAUNCH_VY,
    });
    state.launched += 1;
    state.launchCursor = (slot + 1) % FOUNDATION_COUNT;
    raiseCue(state, CUES.launch);
    return true;
  }
  return false;
}

/**
 * Advance the launch clock by one frame, launching whatever it is owed.
 *
 * `LAUNCH_INTERVAL` is subtracted rather than the clock being zeroed, so the
 * remainder is carried and the mean gap between launches is exactly
 * `LAUNCH_INTERVAL` however the interval was divided into frames.
 */
export function advanceLaunchClock(state: CascadeState, dt: number): void {
  state.launchClock += dt;
  while (state.launchClock >= LAUNCH_INTERVAL && hasCardToLaunch(state)) {
    state.launchClock -= LAUNCH_INTERVAL;
    if (!launchNext(state)) break;
  }
}

/**
 * One frame of the cascade.
 *
 * Cards in flight are advanced whatever the screen, so a posed flyer flies
 * wherever it was posed; the launching belongs to the `won` screen alone, and is
 * held still by the `launching` gate. The end flag needs all fifty-two cards
 * launched, so posed flyers retiring on a cleared table do not set it.
 */
export function stepCascade(state: CascadeState, dt: number): void {
  advanceFlyers(state, dt);
  if (state.screen === "won" && state.launching) {
    advanceLaunchClock(state, dt);
  }
  if (state.launched >= DECK_SIZE && state.flyers.length === 0) {
    state.cascadeDone = true;
  }
}
