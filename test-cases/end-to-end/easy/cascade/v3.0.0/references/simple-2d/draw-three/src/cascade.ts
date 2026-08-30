// Cascade — the victory cascade (`specs/victory.md`).
//
// Every card on the foundations launches in turn, arcs under gravity, bounces
// along the floor, stamps itself onto the painted layer, and drifts off a side
// edge. The order of the frame is the order that file states, and it is
// load-bearing: the cards in flight are advanced first, and the launch clock
// after them, which is why a card launched in a frame takes no motion in that
// frame and why one frame after the win the first flyer sits exactly on its
// foundation's anchor.
//
// Everything is integrated against the frame's delta time in seconds. There is no
// fixed timestep anywhere in this build.

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
import { drawCardFace } from "./card-art";
import { nextRange, nextSign } from "./rng";
import { raise, type MutCard, type MutFlyer, type Sim } from "./sim";

/** Stamp one card in flight onto the painted layer at its position. */
function stampFlyer(sim: Sim, flyer: MutFlyer): void {
  sim.trail.stamp((ctx) => {
    drawCardFace(ctx, flyer.x, flyer.y, flyer.suit, flyer.rank);
  });
  sim.trailStamps += 1;
}

/**
 * Advance every card in flight, in order, by the five steps
 * `specs/victory.md` fixes.
 *
 * A card collides with nothing: not the side edges, not the piles beneath it, and
 * not another card in flight.
 */
export function advanceFlyers(sim: Sim, dt: number): void {
  const flying: MutFlyer[] = [];
  for (const flyer of sim.flyers) {
    flyer.vy += GRAVITY * dt;
    flyer.x += flyer.vx * dt;
    flyer.y += flyer.vy * dt;

    if (flyer.y >= FLOOR_Y && flyer.vy > 0) {
      flyer.vy = -flyer.vy * BOUNCE_DAMP;
      flyer.y = FLOOR_Y;
    }

    if (sim.trailPainting) stampFlyer(sim, flyer);

    if (flyer.x + CARD_W < 0 || flyer.x > STAGE_W) continue;
    flying.push(flyer);
  }
  sim.flyers = flying;
}

/**
 * The foundation whose turn it is to launch, or `null` when none holds a card.
 *
 * The order cycles the four foundations and skips one that has been emptied, so
 * each foundation walks its King down to its Ace over its turns.
 */
export function nextLaunchFoundation(sim: Sim): number | null {
  const start = sim.launched % FOUNDATION_COUNT;
  for (let step = 0; step < FOUNDATION_COUNT; step++) {
    const index = (start + step) % FOUNDATION_COUNT;
    if ((sim.foundations[index] as MutCard[]).length > 0) return index;
  }
  return null;
}

/** Launch the top card of foundation `index` into flight. */
export function launchFrom(sim: Sim, index: number): void {
  const pile = sim.foundations[index] as MutCard[];
  const card = pile.pop();
  if (card === undefined) return;

  const [magnitude, afterMagnitude] = nextRange(
    sim.rngState,
    LAUNCH_VX_MIN,
    LAUNCH_VX_MAX,
  );
  const [sign, afterSign] = nextSign(afterMagnitude);
  sim.rngState = afterSign;

  sim.flyers.push({
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    x: FOUNDATION_X[index] ?? 0,
    y: TOP_ROW_Y,
    vx: sign * magnitude,
    vy: LAUNCH_VY,
  });
  sim.launched += 1;
  raise(sim, CUES.launch);
}

/**
 * Run the launch clock for one frame.
 *
 * The remainder is carried, so after `t` seconds of a running cascade exactly
 * `floor(t / LAUNCH_INTERVAL) + 1` cards have launched and the cadence does not
 * drift.
 */
export function runLaunchClock(sim: Sim, dt: number): void {
  sim.launchClock += dt;
  while (sim.launchClock >= LAUNCH_INTERVAL && sim.launched < DECK_SIZE) {
    const index = nextLaunchFoundation(sim);
    if (index === null) return;
    sim.launchClock -= LAUNCH_INTERVAL;
    launchFrom(sim, index);
  }
}

/** One frame of the cascade: the cards in flight, then the launch clock. */
export function stepCascade(sim: Sim, dt: number): void {
  advanceFlyers(sim, dt);

  if (sim.screen === "won") {
    if (sim.launching) runLaunchClock(sim, dt);
    if (sim.launched >= DECK_SIZE && sim.flyers.length === 0) {
      sim.cascadeDone = true;
    }
  }
}
