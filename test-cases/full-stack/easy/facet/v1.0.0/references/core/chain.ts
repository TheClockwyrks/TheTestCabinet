// Facet — a chain step, the cadence it runs at, and what a settled board does.
//
// `rules.ts` holds R1 to R9 as pure functions of a board. This module is where
// the specification's `## A chain step` list is written down: the ORDER those
// rules run in, the `STEP_SECONDS` cadence that carries a chain from one step
// to the next, the scoring that comes out of it, and the level and end
// conditions evaluated when `phase` returns to `idle`.
//
// Every duration here is game time, taken from the delta the runtime hands each
// update. Nothing in this module reads a real clock, which is what lets
// `advance(seconds, frames)` drive a whole chain from code.

import {
  LEVEL_TARGET_STEP,
  MAX_MULTIPLIER,
  REFUSAL_SECONDS,
  STEP_SECONDS,
} from "../constants";
import { dealOpeningBoard } from "./deal";
import { cursor } from "./rng";
import {
  applyStrain,
  applySwap,
  creationsFor,
  expandClearSet,
  judgeSwap,
  legalSwapExists,
  placeCreations,
  prismSeed,
  removeCells,
  scoreClearSet,
  seedFromRuns,
  settleAndRefill,
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

// ---- One step ------------------------------------------------------------

/** What one chain step did, beside the board it left. */
export interface StepOutcome {
  readonly board: BoardState;
  readonly rngState: number;
  /** How many cells the step cleared. */
  readonly cleared: number;
  /** What the step scored, at its multiplier. */
  readonly points: number;
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
 *   2. R6 grows the seed to the clear set.
 *   3. The clear set scores, off the strain it carries NOW, before R7 moves it.
 *   4. R7 raises the strain of the gems around the clear set.
 *   5. The clear set is removed, leaving its cells empty.
 *   6. R8 creates the cut gems, into cells the removal just emptied.
 *   7. R9 settles each column and refills it from the seeded generator.
 */
export function resolveStep(
  board: BoardState,
  rngState: number,
  multiplier: number,
  seed: StepSeed,
  chainSwap: CellPair | null,
): StepOutcome {
  const cleared = expandClearSet(board, seed.cells);
  const points = scoreClearSet(board, cleared, multiplier);
  const strained = applyStrain(board, cleared);
  const emptied = removeCells(strained.board, cleared);
  const creations = creationsFor(seed.runs, chainSwap);
  const cut = placeCreations(emptied, creations);
  const rng = cursor(rngState);
  return {
    board: settleAndRefill(cut, rng),
    rngState: rng.state,
    cleared: cleared.size,
    points,
    flawed: strained.flawed,
    created: creations.length,
  };
}

/**
 * One step applied to the game's state: the board it leaves, the points it
 * adds to both `score` and `levelScore`, what it did for the readouts, and the
 * cues it raises. `phase` stays `resolving`, because whether the chain carries
 * on is read off the board one `STEP_SECONDS` later.
 */
function takeStep(
  state: FacetState,
  seed: StepSeed,
  chainStep: number,
): Stepped {
  const outcome = resolveStep(
    state.board,
    state.rngState,
    multiplierFor(chainStep),
    seed,
    state.chainSwap,
  );
  return {
    state: {
      ...state,
      board: outcome.board,
      rngState: outcome.rngState,
      score: state.score + outcome.points,
      levelScore: state.levelScore + outcome.points,
      lastCleared: outcome.cleared,
      lastPoints: outcome.points,
      chainStep,
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

// ---- Requesting a swap (R1, R2, R3) --------------------------------------

/** A judged swap, so a caller can tell an acceptance from a refusal. */
export interface SwapRequest extends Stepped {
  readonly verdict: SwapVerdict;
}

/**
 * The one acceptance path every requested swap goes through, whether a press, a
 * drag, the keyboard, or a posed `requestSwap` asked for it.
 *
 * An accepted swap exchanges the two cells at once, sets `chainStep` to `1` and
 * `phase` to `resolving`, and resolves step `1` IMMEDIATELY — the cadence
 * governs the steps after the first, not the first. A refused swap changes
 * nothing on the board and names the two cells as the standing refusal for
 * `REFUSAL_SECONDS`.
 *
 * The selection is untouched either way: the caller that has one clears it.
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

  const board = applySwap(state.board, swap);
  const swapped: FacetState = {
    ...state,
    board,
    chainSwap: swap,
    phase: "resolving",
    chainStep: 1,
    stepTimer: 0,
    refusal: null,
    refusalTimer: 0,
  };
  // R5: step 1 of a chain begun by a prism swap is seeded from the prism
  // instead of from the runs, and a prism-seeded step has no runs for R8.
  const seed = prismSeed(board, swap) ?? seedFromRuns(board);
  const stepped = takeStep(swapped, seed, 1);
  return {
    state: stepped.state,
    events: mergeEvents(stepped.events, { ...NO_EVENTS, swap: true }),
    verdict,
  };
}

// ---- The cadence ---------------------------------------------------------

/**
 * The chain carried forward by `dt` of game time.
 *
 * `stepTimer` accumulates while `phase` is `resolving`, and each time it
 * reaches `STEP_SECONDS` the board is read again: a non-empty clear set under
 * R5 raises `chainStep` and resolves another step, and an empty one settles the
 * chain. The timer is REDUCED by `STEP_SECONDS` on each crossing rather than
 * zeroed, so that one frame of a second and sixty frames of a sixtieth cover
 * the same four steps — which is what `advance(1, 1)` and `advance(1, 60)`
 * reaching the same outcome depends on.
 */
function advanceChain(state: FacetState, dt: number): Stepped {
  if (state.phase !== "resolving") return quiet(state);

  let current = state;
  let events: FacetEvents = NO_EVENTS;
  let timer = state.stepTimer + dt;

  while (current.phase === "resolving" && timer >= STEP_SECONDS) {
    timer -= STEP_SECONDS;
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
 * The chain settled: `phase` returns to `idle`, `chainStep` to `0`, and the
 * level and end conditions are evaluated in the specification's order — the
 * level first, and the end of the round only otherwise, since the fresh board a
 * level-up deals always carries a legal swap.
 */
function settleChain(state: FacetState): Stepped {
  const idle: FacetState = {
    ...state,
    phase: "idle",
    chainStep: 0,
    stepTimer: 0,
    chainSwap: null,
  };

  if (idle.levelScore >= levelTarget(idle.level)) {
    const deal = dealOpeningBoard(idle.rngState);
    return {
      state: {
        ...idle,
        level: idle.level + 1,
        levelScore: 0,
        board: deal.board,
        rngState: deal.rngState,
        selection: null,
        refusal: null,
        refusalTimer: 0,
      },
      events: { ...NO_EVENTS, levelUp: true },
    };
  }

  if (!legalSwapExists(idle.board)) {
    return {
      state: { ...idle, screen: "gameover", menuIndex: 0, selection: null },
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
 * `simTime` accumulates on every screen. The board, the chain, its step timer,
 * and the refusal mark advance only on `playing`, so `paused` holds the
 * position exactly where it stood.
 */
export function tick(state: FacetState, dt: number): Stepped {
  const timed: FacetState = { ...state, simTime: state.simTime + dt };
  if (timed.screen !== "playing") return quiet(timed);
  return advanceChain(advanceRefusal(timed, dt), dt);
}
