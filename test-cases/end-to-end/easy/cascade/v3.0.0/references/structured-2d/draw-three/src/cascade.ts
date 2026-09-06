// Cascade — the victory cascade (`specs/victory.md`).
//
// The cascade begins with the win. Every card on the foundations launches in
// turn, arcs under gravity, bounces along the floor, paints itself onto the
// table as it goes, and drifts off a side edge.
//
// Every rate here is PER SECOND and is integrated against the delta the frame
// supplies, so the motion depends on the elapsed game time alone and reads
// nothing from the renderer. There is no fixed timestep and nothing counts
// frames.
//
// A FRAME OF A RUNNING CASCADE runs in the order the specification fixes: every
// card in flight is advanced, in order, by gravity, then by its velocity, then by
// the floor bounce, then stamped onto the painted layer, then retired if it has
// cleared a side edge; and only then does the launch clock advance. So a card
// launched in a frame takes no motion in that frame, and one frame after the win
// the first flyer sits exactly on its foundation's anchor.
//
// The clock CARRIES ITS REMAINDER. A frame long enough to cover several intervals
// launches several cards, so the cadence does not drift however coarsely game
// time was divided into frames.
//
// The flyers are advanced whatever the screen, because a flyer posed through the
// debug surface flies by the game's own rules from the moment it is added. The
// LAUNCHING is the cascade's own and runs on the `won` screen alone, so a posed
// board never empties its foundations on its own.

import type { FrameEvents } from "./audio";
import {
  BOUNCE_DAMP,
  CARD_W,
  DECK_SIZE,
  FLOOR_Y,
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
import { nextRange, nextSign } from "./rng";
import { paintCardOnTrail } from "./render";

/** One card in flight, appended to the flight under the id it is given. */
function pushFlyer(
  state: CascadeState,
  id: number,
  suit: Suit,
  rank: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
): FlyerState {
  const flyer: FlyerState = { id, suit, rank, x, y, vx, vy };
  state.flyers.push(flyer);
  return flyer;
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
): FlyerState {
  const id = state.nextId;
  state.nextId += 1;
  return pushFlyer(state, id, suit, rank, x, y, vx, vy);
}

/** The flyer with that id, or `undefined`. */
export function flyerById(
  state: CascadeState,
  id: number,
): FlyerState | undefined {
  return state.flyers.find((flyer) => flyer.id === id);
}

/** Whether any foundation still holds a card the cascade could launch. */
export function cardsRemainToLaunch(state: CascadeState): boolean {
  return state.foundations.some((foundation) => foundation.length > 0);
}

/**
 * The foundation whose turn it is: the launch order cycles the four foundations
 * and skips one that has been emptied, so the turn is the first foundation still
 * holding a card at or after `launched % FOUNDATION_COUNT`. Four foundations
 * dealt full therefore go `0, 1, 2, 3, 0, ...` for all fifty-two launches, and
 * each walks its King down to its Ace.
 */
export function nextFoundation(state: CascadeState): number {
  const count = state.foundations.length;
  const start = ((state.launched % count) + count) % count;
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    if (state.foundations[index].length > 0) return index;
  }
  return -1;
}

/**
 * Launch the next card: it leaves the top of the foundation whose turn it is and
 * becomes a card in flight at that foundation's anchor, popping upward at
 * `LAUNCH_VY` with a horizontal speed drawn afresh at the launch: a magnitude
 * uniform in `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]` and a sign chosen with equal
 * probability.
 */
export function launchOne(
  state: CascadeState,
  events: FrameEvents,
): FlyerState | null {
  const index = nextFoundation(state);
  if (index < 0) return null;

  const card = state.foundations[index].pop();
  if (card === undefined) return null;

  const magnitude = nextRange(LAUNCH_VX_MIN, LAUNCH_VX_MAX);
  const sign = nextSign();
  // A launched card keeps the id it carried on the table
  // (`specs/instrumentation.md`, Identity), so it is followed from the
  // foundation into the flight.
  const flyer = pushFlyer(
    state,
    card.id,
    card.suit,
    card.rank,
    FOUNDATION_X[index],
    TOP_ROW_Y,
    magnitude * sign,
    LAUNCH_VY,
  );

  state.launched += 1;
  events.launch = true;
  return flyer;
}

/**
 * Begin the cascade. The launch clock holds one whole interval, so the first card
 * launches on the cascade's first frame rather than on the frame the win landed
 * in.
 */
export function beginCascade(state: CascadeState): void {
  state.launchClock = LAUNCH_INTERVAL;
  state.launched = 0;
  state.flyers = [];
  state.cascadeDone = false;
}

/** Every card in flight, and then the launch clock. */
export function advanceCascade(
  state: CascadeState,
  dt: number,
  events: FrameEvents,
): void {
  advanceFlyers(state, dt);

  if (state.screen !== "won") return;

  if (state.launching) {
    state.launchClock += dt;
    while (state.launchClock >= LAUNCH_INTERVAL && cardsRemainToLaunch(state)) {
      state.launchClock -= LAUNCH_INTERVAL;
      launchOne(state, events);
    }
  }

  // The cascade's own end test: every one of the fifty-two cards has launched
  // and none is still in flight. `launched` is counted rather than derived, so
  // flyers posed onto a cleared table never satisfy it.
  if (state.launched >= DECK_SIZE && state.flyers.length === 0) {
    state.cascadeDone = true;
  }
}

/**
 * One frame for every card in flight, in order: gravity, then motion, then the
 * floor bounce, then the stamp, then the retirement. A card collides with
 * nothing, so the side edges, the piles beneath it and the other flyers all pass
 * through it.
 */
export function advanceFlyers(state: CascadeState, dt: number): void {
  const survivors: FlyerState[] = [];

  for (const flyer of state.flyers) {
    flyer.vy += GRAVITY * dt;
    flyer.x += flyer.vx * dt;
    flyer.y += flyer.vy * dt;

    if (flyer.y >= FLOOR_Y && flyer.vy > 0) {
      flyer.vy = -flyer.vy * BOUNCE_DAMP;
      flyer.y = FLOOR_Y;
    }

    if (state.trailPainting) {
      state.trail.stamp((ctx) => {
        paintCardOnTrail(ctx, flyer.x, flyer.y, flyer.suit, flyer.rank);
      });
      state.trailStamps += 1;
    }

    if (flyer.x + CARD_W < 0 || flyer.x > STAGE_W) continue;
    survivors.push(flyer);
  }

  state.flyers = survivors;
}
