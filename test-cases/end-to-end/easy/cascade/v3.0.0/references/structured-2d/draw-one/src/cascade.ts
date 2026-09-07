// Cascade — the victory cascade (specs/victory.md).
//
// The cascade is the game's ending: every card on the foundations launches in
// turn, arcs under gravity, bounces along the floor, stamps itself onto the
// painted layer, and drifts off a side edge.
//
// Two rules here are worth stating plainly, because both are what make the
// motion assertable:
//
//   The integration is semi-implicit Euler, in the order the specification
//   fixes: gravity, then the advance, then the floor bounce, then the stamp,
//   then the retirement. Every rate is per second and multiplied by the frame's
//   own delta, so the simulation reads nothing from the renderer.
//
//   The launch clock CARRIES ITS REMAINDER. A frame long enough to cover
//   several intervals launches several cards, and after `t` seconds of a
//   running cascade exactly `floor(t / LAUNCH_INTERVAL) + 1` cards have
//   launched, so the cadence does not drift however the interval was divided
//   into frames.
//
// The cards in flight are advanced on every screen, so a flyer posed on a
// cleared table moves exactly as one launched by a win does; the launch clock
// runs only on the `won` screen, where a cascade is what is happening.

import type { FrameCues } from "./audio";
import {
  BOUNCE_DAMP,
  CARD_W,
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
import type { CascadeState, FlyerState, Suit } from "./game";
import { takeId } from "./piles";
import { drawCard } from "./render";
import { nextRandom } from "./rng";

/**
 * Enter the cascade. The launch clock starts holding a whole interval, so the
 * first card launches on the cascade's very first frame, and the count starts
 * from zero because this cascade has launched nothing yet.
 */
export function beginCascade(state: CascadeState): void {
  state.launchClock = LAUNCH_INTERVAL;
  state.launched = 0;
  state.cascadeDone = false;
}

/** One card in flight, appended to the flight and taking a fresh id. */
export function addFlyerTo(
  state: CascadeState,
  suit: Suit,
  rank: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  id = takeId(state),
): FlyerState {
  const flyer: FlyerState = { id, suit, rank, x, y, vx, vy };
  state.flyers.push(flyer);
  return flyer;
}

/**
 * The foundation whose turn it is to launch: the cycle steps `0, 1, 2, 3, 0`
 * with the count of cards already launched, and skips a foundation that has
 * been emptied. `null` once every foundation is empty.
 *
 * The position in the cycle is read off `launched` rather than kept in a field
 * of its own, so nothing authoritative lives outside the declared state
 * (specs/state.md). On the only board a cascade is ever entered from — a won
 * game, whose four foundations each hold thirteen cards and empty in lockstep —
 * that reproduces the stated cycle exactly.
 */
export function nextFoundation(state: CascadeState): number | null {
  const start = state.launched % FOUNDATION_COUNT;
  for (let step = 0; step < FOUNDATION_COUNT; step += 1) {
    const index = (start + step) % FOUNDATION_COUNT;
    if (state.foundations[index].length > 0) return index;
  }
  return null;
}

/**
 * One launch's `vx`: a magnitude drawn uniformly from its range and a sign
 * chosen with equal probability, each afresh at the call (specs/victory.md).
 */
export function drawLaunchVx(): number {
  const magnitude =
    LAUNCH_VX_MIN + nextRandom() * (LAUNCH_VX_MAX - LAUNCH_VX_MIN);
  const sign = nextRandom() < 0.5 ? -1 : 1;
  return sign * magnitude;
}

/** Launch the next card: it leaves its foundation and becomes a card in flight. */
function launchNext(state: CascadeState, cues: FrameCues): boolean {
  const index = nextFoundation(state);
  if (index === null) return false;
  const foundation = state.foundations[index];
  const card = foundation[foundation.length - 1];
  foundation.pop();

  // A launched card keeps the id it carried on the table (specs/instrumentation.md).
  addFlyerTo(
    state,
    card.suit,
    card.rank,
    FOUNDATION_X[index],
    TOP_ROW_Y,
    drawLaunchVx(),
    LAUNCH_VY,
    card.id,
  );
  state.launched += 1;
  cues.launch = true;
  return true;
}

/** Stamp one card in flight onto the painted layer, at the position it holds now. */
function stamp(state: CascadeState, flyer: FlyerState): void {
  state.trail.stamp((ctx) => {
    drawCard(ctx, flyer.x, flyer.y, flyer.suit, flyer.rank, true);
  });
  state.trailStamps += 1;
}

/**
 * One frame of the cascade.
 *
 * Every card in flight is advanced first, in order, and the launch clock after
 * them, so a card launched in a frame takes no motion in that frame.
 */
export function advanceCascade(
  state: CascadeState,
  dt: number,
  cues: FrameCues,
): void {
  const surviving: FlyerState[] = [];
  for (const flyer of state.flyers) {
    flyer.vy += GRAVITY * dt;
    flyer.x += flyer.vx * dt;
    flyer.y += flyer.vy * dt;
    if (flyer.y >= FLOOR_Y && flyer.vy > 0) {
      flyer.vy = -flyer.vy * BOUNCE_DAMP;
      flyer.y = FLOOR_Y;
    }
    if (state.trailPainting) stamp(state, flyer);
    // A card collides with nothing, so only the side edges retire it.
    if (flyer.x + CARD_W >= 0 && flyer.x <= STAGE_W) surviving.push(flyer);
  }
  state.flyers = surviving;

  if (state.screen !== "won") return;

  if (state.launching) {
    state.launchClock += dt;
    while (state.launchClock >= LAUNCH_INTERVAL) {
      if (!launchNext(state, cues)) break;
      state.launchClock -= LAUNCH_INTERVAL;
    }
  }

  if (state.launched >= DECK_SIZE && state.flyers.length === 0) {
    state.cascadeDone = true;
  }
}
