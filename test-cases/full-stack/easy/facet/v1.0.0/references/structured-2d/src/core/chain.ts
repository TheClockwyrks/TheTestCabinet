// Facet — a chain step, the cadence it runs at, and what a settled board does.
//
// `rules.ts` holds R1 to R9 as pure functions of a board. This module is where
// the specification's `## A chain step` list is written down: the ORDER those
// rules run in, the swap that runs before the first of them, the cadence that
// carries a chain from one step to the next, the scoring that comes out of it,
// and the level and end conditions evaluated when `phase` returns to `idle`.
//
// A step does not hold for a fixed span. It holds for exactly as long as what
// it set in motion takes — the waves R6 gave its clear set, then the rows R9
// dropped its gems, then a rest — so a step that shattered half the board holds
// longer than one that took three gems, and the board is never read again while
// something a player can see is still moving. `stepHold` is that figure, and
// the cadence subtracts it rather than a constant.
//
// Every duration here is game time, taken from the delta the runtime hands each
// update. Nothing in this module reads a real clock, which is what lets
// `advance(seconds, frames)` drive a whole chain from code.

import {
  FALL_SECONDS_PER_ROW,
  LAND_MIN_ROWS,
  LEVEL_TARGET_STEP,
  MAX_MULTIPLIER,
  REFUSAL_SECONDS,
  STEP_SECONDS,
  SWAP_SECONDS,
  WAVE_SECONDS,
} from "../constants";
import { randomPicker } from "./random";
import {
  applyStrain,
  applySwap,
  creationsFor,
  expandClearSet,
  judgeSwap,
  lastFall,
  legalSwapExists,
  placeCreations,
  posedRefill,
  prismSeed,
  removeCells,
  scoreClearSet,
  seedFromRuns,
  settleAndRefill,
  type RefillKindAt,
  type StepSeed,
  type SwapVerdict,
} from "./rules";
import {
  mergeEvents,
  NO_EVENTS,
  quiet,
  type BoardState,
  type CellPair,
  type FacetEvents,
  type FacetState,
  type Stepped,
} from "./state";

/** The level's target, derived rather than stored (specs/rules.md). */
export function levelTarget(level: number): number {
  return LEVEL_TARGET_STEP * level;
}

/** The step's multiplier, `M = min(chainStep, MAX_MULTIPLIER)`. */
export function multiplierFor(chainStep: number): number {
  return Math.min(chainStep, MAX_MULTIPLIER);
}

// ---- What a step's timing is worth ---------------------------------------

/**
 * `SHATTER_END`: the game time the step's clear set takes to shatter, a cell at
 * wave `w` going at `w * WAVE_SECONDS`.
 */
export function shatterEnd(state: FacetState): number {
  return state.lastWaves * WAVE_SECONDS;
}

/**
 * `LAND_AT`: the game time by which every gem the step moved has arrived, which
 * is the shattering followed by the longest fall on the board. It is the moment
 * the `land` cue plays.
 */
export function landAt(state: FacetState): number {
  return shatterEnd(state) + lastFall(state.board) * FALL_SECONDS_PER_ROW;
}

/**
 * `STEP_HOLD`: how long the step in progress holds before the board is read
 * again — the shattering, the fall, and then `STEP_SECONDS` of rest.
 */
export function stepHold(state: FacetState): number {
  return landAt(state) + STEP_SECONDS;
}

// ---- One step ------------------------------------------------------------

/** What one chain step did, beside the board it left. */
export interface StepOutcome {
  readonly board: BoardState;
  /** How many cells the step cleared. */
  readonly cleared: number;
  /** What the step scored, at its multiplier. */
  readonly points: number;
  /** The greatest wave R6 gave the clear set, which times the shattering. */
  readonly waves: number;
  /** How many gems R7 left newly flawed. */
  readonly flawed: number;
  /** How many cut gems R8 created. */
  readonly created: number;
}

/**
 * One chain step, resolved in exactly the order `specs/rules.md` lists:
 *
 *   1. R5 seeds the clear set — handed in, because step `1` of a chain begun by
 *      a prism swap is seeded differently from every other step.
 *   2. R6 grows the seed to the clear set, and gives every cell of it a wave.
 *   3. The clear set scores, off the strain it carries NOW, before R7 moves it.
 *   4. R7 raises the strain of the gems around the clear set.
 *   5. The clear set is removed, leaving its cells empty.
 *   6. R8 creates the cut gems, into cells the removal just emptied.
 *   7. R9 settles each column, refills it, and gives every gem its `fell`.
 *
 * `refill` is what the refill deals into each emptied cell: the draw R9
 * states, or a kind a pose stands in for it.
 */
export function resolveStep(
  board: BoardState,
  multiplier: number,
  seed: StepSeed,
  chainSwap: CellPair | null,
  refill: RefillKindAt,
): StepOutcome {
  const expanded = expandClearSet(board, seed.cells);
  const cleared = expanded.cells;
  const points = scoreClearSet(board, cleared, multiplier);
  const strained = applyStrain(board, cleared);
  const emptied = removeCells(strained.board, cleared);
  const creations = creationsFor(seed.runs, chainSwap);
  const cut = placeCreations(emptied, creations);
  return {
    board: settleAndRefill(cut, refill),
    cleared: cleared.size,
    points,
    waves: expanded.waves,
    flawed: strained.flawed,
    created: creations.length,
  };
}

/**
 * One step applied to the game's state: the board it leaves, the points it adds
 * to `score`, `levelScore` and `moveScore` alike, the depth it takes
 * `bestChain` to, what it did for the readouts, and the cues it raises. `phase`
 * stays `resolving`, because whether the chain carries on is read off the board
 * one `stepHold` later.
 */
function takeStep(
  state: FacetState,
  seed: StepSeed,
  chainStep: number,
): Stepped {
  const outcome = resolveStep(
    state.board,
    multiplierFor(chainStep),
    seed,
    state.chainSwap,
    posedRefill(state.refillKinds, randomPicker),
  );
  return {
    state: {
      ...state,
      board: outcome.board,
      score: state.score + outcome.points,
      levelScore: state.levelScore + outcome.points,
      moveScore: state.moveScore + outcome.points,
      bestChain: Math.max(state.bestChain, chainStep),
      lastCleared: outcome.cleared,
      lastPoints: outcome.points,
      lastWaves: outcome.waves,
      chainStep,
      swapTimer: 0,
      phase: "resolving",
    },
    events: {
      ...NO_EVENTS,
      clear: outcome.cleared > 0,
      flaw: outcome.flawed > 0,
      cut: outcome.created > 0,
    },
  };
}

/** How R5 seeds step `1`, which is the only step a prism swap seeds. */
function firstSeed(board: BoardState, swap: CellPair | null): StepSeed {
  const prism = swap === null ? null : prismSeed(board, swap);
  return prism ?? seedFromRuns(board);
}

// ---- Requesting a swap (R1, R2, R3) --------------------------------------

/** A judged swap, so a caller can tell an acceptance from a refusal. */
export interface SwapRequest extends Stepped {
  readonly verdict: SwapVerdict;
}

/**
 * The one acceptance path every requested swap goes through, whether a
 * release, or a posed `requestSwap`, asked for it.
 *
 * An accepted swap exchanges the two cells at once and puts the game into
 * `swapping`: the two gems are in motion between their cells, nothing is
 * cleared, and `chainStep` stays `0` until `SWAP_SECONDS` of game time has
 * passed. It also returns `moveScore` to `0`, because the move whose points
 * that figure holds begins here. A refused swap changes nothing on the board
 * and names the two cells as the standing refusal for `REFUSAL_SECONDS`.
 *
 * The selection and the offer are untouched either way: the caller that has
 * them clears them.
 */
export function requestSwap(state: FacetState, swap: CellPair): SwapRequest {
  // A swap is a move on the board being played. Off `playing` there is no move
  // to make and nothing to mark, so the request is simply not a request.
  if (state.screen !== "playing") {
    return { ...quiet(state), verdict: "adjacency" };
  }

  const verdict = judgeSwap(state.board, state.phase, swap);
  if (verdict !== "accepted") {
    return {
      state: { ...state, refusal: swap, refusalTimer: 0 },
      events: { ...NO_EVENTS, refuse: true },
      verdict,
    };
  }

  return {
    state: {
      ...state,
      board: applySwap(state.board, swap),
      chainSwap: swap,
      phase: "swapping",
      chainStep: 0,
      swapTimer: 0,
      stepTimer: 0,
      moveScore: 0,
      refusal: null,
      refusalTimer: 0,
    },
    events: { ...NO_EVENTS, swap: true },
    verdict,
  };
}

// ---- The cadence ---------------------------------------------------------

/**
 * The chain carried forward by `dt` of game time, from a state already
 * `resolving` with `before` on its step timer.
 *
 * `stepTimer` accumulates while `phase` is `resolving`, and each time it
 * reaches the step's own `stepHold` the board is read again: a non-empty clear
 * set under R5 raises `chainStep` and resolves another step, and an empty one
 * settles the chain. The timer is REDUCED by that hold on each crossing rather
 * than zeroed, so that one frame of a second and sixty frames of a sixtieth
 * cover the same steps — which is what `advance(1, 1)` and `advance(1, 60)`
 * reaching the same outcome depends on.
 *
 * `land` plays on the frame the timer crosses the step's `landAt`, and only for
 * a step whose longest fall was longer than `LAND_MIN_ROWS` rows, so a gem
 * dropping into the cell below it makes no noise. One frame can cross several
 * boundaries, so the flag is merged like every other event and a cue is played
 * once however many times its event happened.
 */
function advanceChain(state: FacetState, dt: number): Stepped {
  let current = state;
  let events: FacetEvents = NO_EVENTS;
  let before = state.stepTimer;
  let timer = state.stepTimer + dt;

  while (current.phase === "resolving") {
    const land = landAt(current);
    if (
      before < land &&
      timer >= land &&
      lastFall(current.board) > LAND_MIN_ROWS
    ) {
      events = mergeEvents(events, { ...NO_EVENTS, land: true });
    }

    const hold = stepHold(current);
    if (timer < hold) break;
    timer -= hold;
    before = 0;

    const seed = seedFromRuns(current.board);
    if (seed.cells.size === 0) {
      const settled = settleChain(current);
      current = settled.state;
      events = mergeEvents(events, settled.events);
      timer = 0;
      break;
    }
    const stepped = takeStep(current, seed, current.chainStep + 1);
    current = stepped.state;
    events = mergeEvents(events, stepped.events);
  }

  return {
    state: {
      ...current,
      stepTimer: current.phase === "resolving" ? timer : 0,
    },
    events,
  };
}

/**
 * The swap in motion carried forward by `dt`. When `swapTimer` reaches
 * `SWAP_SECONDS` the overrun is carried straight into the step timer rather
 * than discarded, which is what keeps a chain driven by one large frame in step
 * with the same chain driven by many small ones.
 */
function advanceSwap(state: FacetState, dt: number): Stepped {
  const swapTimer = state.swapTimer + dt;
  if (swapTimer < SWAP_SECONDS) return quiet({ ...state, swapTimer });

  const opened: FacetState = { ...state, swapTimer: 0, stepTimer: 0 };
  const first = takeStep(opened, firstSeed(opened.board, opened.chainSwap), 1);
  const carried = advanceChain(first.state, swapTimer - SWAP_SECONDS);
  return {
    state: carried.state,
    events: mergeEvents(first.events, carried.events),
  };
}

/**
 * The chain settled: `phase` returns to `idle`, `chainStep` to `0`, the move's
 * points are weighed against the level's best, and the level and end conditions
 * are evaluated in the specification's order — the level first, and the end of
 * the round only otherwise.
 *
 * A level that is over is NOT advanced here. The board stands as the chain left
 * it, `screen` becomes `levelclear`, and the figures the level was measured by
 * hold what it left them at, because that screen is what reports them; the next
 * level is opened by taking `CONTINUE` on it.
 */
function settleChain(state: FacetState): Stepped {
  const idle: FacetState = {
    ...state,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    chainSwap: null,
    bestMove: Math.max(state.bestMove, state.moveScore),
  };

  if (idle.levelScore >= levelTarget(idle.level)) {
    return {
      state: {
        ...idle,
        screen: "levelclear",
        menuIndex: 0,
        selection: null,
        offer: null,
        armedTarget: null,
      },
      events: { ...NO_EVENTS, levelUp: true },
    };
  }

  if (!legalSwapExists(idle.board)) {
    return {
      state: {
        ...idle,
        screen: "gameover",
        menuIndex: 0,
        selection: null,
        offer: null,
        armedTarget: null,
      },
      events: { ...NO_EVENTS, gameOver: true },
    };
  }

  return quiet(idle);
}

/** The standing refusal aged by `dt`, and dropped once it has stood long enough. */
function advanceRefusal(state: FacetState, dt: number): FacetState {
  if (!state.refusal) return state;
  const refusalTimer = state.refusalTimer + dt;
  if (refusalTimer >= REFUSAL_SECONDS) {
    return { ...state, refusal: null, refusalTimer: 0 };
  }
  return { ...state, refusalTimer };
}

/**
 * One update's worth of game time, which is the whole of what the core does per
 * frame once the frame's input has been read.
 *
 * `simTime` accumulates on every screen. The swap in motion, the board, the
 * chain, its step timer, and the refusal mark advance only on `playing`, so
 * `paused` holds the position exactly where it stood.
 */
export function tick(state: FacetState, dt: number): Stepped {
  const timed: FacetState = { ...state, simTime: state.simTime + dt };
  if (timed.screen !== "playing") return quiet(timed);

  const aged = advanceRefusal(timed, dt);
  if (aged.phase === "swapping") return advanceSwap(aged, dt);
  if (aged.phase === "resolving") return advanceChain(aged, dt);
  return quiet(aged);
}
