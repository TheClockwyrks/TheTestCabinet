// Facet — what a batch of transitions did: the cues it raised and the chain
// steps it resolved.
//
// One frame of Facet is several transitions: the actions the player controller
// read, the pointer samples it resolved, and the game time the game mode
// carried the swap in motion and the chain forward by. A batch is those
// transitions accumulated — the state they reached, the cues they raised
// between them, and one report per chain step that resolved. `src/controller.ts`
// builds one, `src/frame.ts` builds one and merges the controller's into it,
// and `src/debug.ts` reports a single posed transition through the same
// `reportFor`.
//
// TWO THINGS HERE EXIST TO SERVE THE PRESENTATION, and both keep decoration out
// of the state.
//
//   * `reportFor` re-derives WHICH cells a chain step cleared, at WHICH wave,
//     and which cells it created, from the core's own R5, R6, and R8 over the
//     board that step actually read. The core reports THAT a step cleared
//     something; a shatter sheet needs the cells and the wave that times it,
//     and `specs/instrumentation.md` rests on the state advancing from the
//     delta alone, so a decorative detail does not belong in it. It is
//     always given the two states either side of ONE transition, so the board it
//     reads is the board that step read — an accepted swap exchanges its two
//     cells the moment it is accepted, one transition before the step that
//     reads them, so nothing here re-applies it.
//   * `advanceTime` slices a frame's delta into pieces no longer than one
//     `STEP_SECONDS`, so no slice can cross more than one chain step and every
//     step that runs can be reported — even from a single long frame. A step
//     holds for at least `STEP_SECONDS` whatever it set in motion, and the swap
//     in motion is shorter still, so one slice reaches at most one step
//     boundary. Every timer in this game is a linear accumulator, so the same
//     interval reaches the same state however it is divided, and the slicing
//     changes nothing about what the core resolves.

import { MAX_STRAIN, STEP_SECONDS } from "./constants";
import { isDealtBoard, type Presentation, type StepReport } from "./effects";
import type { AssetStore } from "./assets";
import {
  cellKey,
  cellsIn,
  creationsFor,
  expandClearSet,
  gemAt,
  mergeEvents,
  multiplierFor,
  NO_EVENTS,
  prismSeed,
  seedFromRuns,
  tick,
  type FacetEvents,
  type FacetState as CoreState,
  type Stepped,
} from "./core";

/**
 * The most slices one frame's delta is cut into before the rest of it is run in
 * one go. A frame is normally worth well under one `STEP_SECONDS`, so this only
 * bites on an absurd single frame of many seconds, where losing the per-step
 * effect reports of the tail is the right trade against a hung tab.
 */
export const MAX_SLICES = 512;

/** What a batch of transitions accumulated. */
export interface StepBatch {
  state: CoreState;
  events: FacetEvents;
  /** One entry per chain step the batch resolved, in order. */
  steps: StepReport[];
  /** The highest multiplier any of those steps scored at; the ladder rung. */
  rung: number;
  /**
   * Whether some transition replaced the board outright, so whatever was still
   * flying belongs to a board that is gone.
   */
  replaced: boolean;
  /** Whether the board that replacement dealt came in from above (`pour`). */
  dealt: boolean;
}

/** A batch that has done nothing yet. */
export function openBatch(state: CoreState): StepBatch {
  return {
    state,
    events: NO_EVENTS,
    steps: [],
    rung: 0,
    replaced: false,
    dealt: false,
  };
}

/**
 * Whether a transition put a DIFFERENT BOARD in play rather than changing the
 * one that was.
 *
 * A chain step is not one, because the board it leaves is the board it was
 * handed, settled. Neither is an accepted swap, which exchanges two cells and
 * sets `phase` to `"swapping"`: the stones on it are the stones that were on
 * it. A fresh deal, a posed board, and a `reset` are, and each one makes
 * whatever is still flying belong to a board nobody can see any more.
 */
export function boardReplaced(before: CoreState, after: CoreState): boolean {
  return (
    after.board !== before.board &&
    after.chainStep <= before.chainStep &&
    after.phase !== "swapping"
  );
}

/**
 * Fold one core transition into the batch: its next state, its cues, and the
 * chain step it resolved, if it resolved one.
 */
export function fold(batch: StepBatch, next: Stepped): StepBatch {
  const report = reportFor(batch.state, next.state);
  if (report !== null) {
    batch.steps.push(report);
    batch.rung = Math.max(batch.rung, multiplierFor(next.state.chainStep));
  }
  if (boardReplaced(batch.state, next.state)) {
    // The reports already collected describe a board that is no longer in
    // play, so they are dropped here rather than thrown at cells that hold
    // something else now.
    batch.steps.length = 0;
    batch.replaced = true;
    batch.dealt = isDealtBoard(next.state.board);
  }
  batch.state = next.state;
  batch.events = mergeEvents(batch.events, next.events);
  return batch;
}

/**
 * What a batch leaves the presentation to play: a board it replaced drops
 * everything flying and pours the new one in from above if that is where it
 * came from, and each step it resolved throws its own sheets and bursts.
 */
export function showBatch(
  presentation: Presentation,
  batch: StepBatch,
  assets: AssetStore,
): void {
  if (batch.replaced) {
    presentation.clear();
    if (batch.dealt) presentation.pour();
  }
  presentation.push(batch.steps, assets);
}

/**
 * What the chain step between `before` and `after` cleared and created, or
 * `null` when no step resolved.
 *
 * Re-derived from the core's own R5, R6, and R8 over the board the step read,
 * which is `before.board` for every step: an accepted swap exchanges its two
 * cells at once and only then waits out `SWAP_SECONDS`, so by the time step `1`
 * resolves the exchange is already on the board. Step `1` of a chain a swap
 * began is the only step that can be seeded from a prism, so it is the only one
 * that asks R5 for a prism seed first.
 */
export function reportFor(
  before: CoreState,
  after: CoreState,
): StepReport | null {
  if (after.chainStep <= before.chainStep) return null;
  const swap = after.chainSwap;
  const begun =
    before.chainStep === 0 && after.chainStep === 1 && swap !== null;
  const board = before.board;
  const seed = begun
    ? (prismSeed(board, swap) ?? seedFromRuns(board))
    : seedFromRuns(board);
  const cleared = expandClearSet(board, seed.cells);
  return {
    cleared: cellsIn(board, cleared.cells).map((cell) => {
      const gem = gemAt(board, cell);
      return {
        col: cell.col,
        row: cell.row,
        kind: gem?.kind ?? null,
        flawed: (gem?.strain ?? 0) >= MAX_STRAIN,
        // R6's wave, which is what delays this cell's shatter within the step
        // (specs/rules.md, The step's timing).
        wave: cleared.waveOf.get(cellKey(cell)) ?? 0,
      };
    }),
    created: creationsFor(seed.runs, swap).map((creation) => creation.cell),
  };
}

/**
 * A batch carried forward by `dt` of game time, in slices no longer than one
 * `STEP_SECONDS`. See the header for why the slicing is here and why it changes
 * nothing about the state the core reaches.
 *
 * The slicing runs while the game is not `idle`, so a frame that arrives with a
 * swap still in motion is cut too: the swap ends inside one slice and the step
 * it opens is reported like any other.
 */
export function advanceTime(batch: StepBatch, dt: number): StepBatch {
  let remaining = dt;
  let slices = 0;
  while (remaining > 0) {
    slices += 1;
    const slice =
      batch.state.phase !== "idle" && slices < MAX_SLICES
        ? Math.min(remaining, STEP_SECONDS)
        : remaining;
    fold(batch, tick(batch.state, slice));
    remaining -= slice;
  }
  return batch;
}
