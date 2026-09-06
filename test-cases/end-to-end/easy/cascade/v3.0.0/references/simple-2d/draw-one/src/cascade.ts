// Cascade — the victory cascade (specs/victory.md).
//
// One frame of a running cascade advances every card in flight, in order, and
// then the launch clock. Every rate here is per second and is integrated against
// the frame's delta, so the cascade reads nothing from the renderer and the same
// second of game time carries a flyer the same distance however it was divided
// into frames.

import {
  BOUNCE_DAMP,
  CARD_W,
  CUES,
  DECK_SIZE,
  FLOOR_Y,
  GRAVITY,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  LAUNCH_VY,
  STAGE_W,
  type CueName,
} from "./constants";
import { drawCard } from "./cards";
import { pileAnchor } from "./layout";
import type { Outcome } from "./moves";
import { nextRange, nextSign } from "./rng";
import type { CardState, CascadeState, FlyerState } from "./game";

/** Whether a flyer has cleared a side edge and leaves the flight. */
export function retired(flyer: FlyerState): boolean {
  return flyer.x + CARD_W < 0 || flyer.x > STAGE_W;
}

/**
 * One card in flight, one frame on: gravity, then motion, then the floor.
 *
 * A bounce reflects the vertical speed and keeps `BOUNCE_DAMP` of it, seats the
 * card on the floor, and leaves the horizontal speed alone, so each bounce peaks
 * lower than the one before it and the card keeps drifting the way it was going.
 */
export function advanceFlyer(flyer: FlyerState, dt: number): FlyerState {
  const vy = flyer.vy + GRAVITY * dt;
  const x = flyer.x + flyer.vx * dt;
  const y = flyer.y + vy * dt;
  if (y >= FLOOR_Y && vy > 0) {
    return { ...flyer, x, y: FLOOR_Y, vy: -vy * BOUNCE_DAMP };
  }
  return { ...flyer, x, y, vy };
}

/**
 * The foundation whose turn it is to launch, or `-1` when every foundation is
 * empty.
 *
 * The order cycles the four foundations and skips one that has been emptied, so
 * each foundation walks its King down to its Ace over its turns.
 */
export function nextFoundation(
  foundations: readonly (readonly CardState[])[],
  launched: number,
): number {
  for (let step = 0; step < foundations.length; step++) {
    const index = (launched + step) % foundations.length;
    if (foundations[index].length > 0) return index;
  }
  return -1;
}

/** One card leaving its foundation for the flight. */
function launch(state: CascadeState, index: number): CascadeState {
  const pile = state.foundations[index];
  const card = pile[pile.length - 1];
  const anchor = pileAnchor("foundation", index);
  const magnitude = nextRange(LAUNCH_VX_MIN, LAUNCH_VX_MAX);
  const sign = nextSign();

  return {
    ...state,
    foundations: state.foundations.map((cards, i) =>
      i === index ? cards.slice(0, cards.length - 1) : cards,
    ),
    flyers: [
      ...state.flyers,
      {
        id: card.id,
        suit: card.suit,
        rank: card.rank,
        x: anchor.x,
        y: anchor.y,
        vx: sign * magnitude,
        vy: LAUNCH_VY,
      },
    ],
    launched: state.launched + 1,
  };
}

/**
 * One frame of the cascade.
 *
 * Every card in flight is advanced, stamped onto the painted layer, and retired
 * past a side edge; the launch clock is advanced after all of them, so a card
 * launched in a frame takes no motion in that frame. The clock carries its
 * remainder, so a frame long enough to cover several intervals launches several
 * cards and the cadence does not drift.
 */
export function stepCascade(state: CascadeState, dt: number): Outcome {
  const cues: CueName[] = [];

  const flying: FlyerState[] = [];
  let stamps = 0;
  for (const flyer of state.flyers) {
    const moved = advanceFlyer(flyer, dt);
    if (state.trailPainting) {
      stamps++;
      state.trail?.stamp((ctx) =>
        drawCard(ctx, { ...moved, faceUp: true }, moved.x, moved.y),
      );
    }
    if (!retired(moved)) flying.push(moved);
  }

  let next: CascadeState = {
    ...state,
    flyers: flying,
    trailStamps: state.trailStamps + stamps,
  };

  if (next.screen === "won" && next.launching) {
    let clock = next.launchClock + dt;
    while (clock >= LAUNCH_INTERVAL && next.launched < DECK_SIZE) {
      const index = nextFoundation(next.foundations, next.launched);
      if (index < 0) break;
      clock -= LAUNCH_INTERVAL;
      next = launch(next, index);
      cues.push(CUES.launch);
    }
    next = { ...next, launchClock: clock };
  }

  const done =
    next.screen === "won" &&
    next.launched >= DECK_SIZE &&
    next.flyers.length === 0;

  return { state: { ...next, cascadeDone: next.cascadeDone || done }, cues };
}
