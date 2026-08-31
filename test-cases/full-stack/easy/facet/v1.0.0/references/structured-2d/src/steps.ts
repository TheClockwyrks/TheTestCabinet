// Facet — what a batch of transitions did: the cues it raised and the chain
// steps it resolved.
//
// One frame of Facet is several transitions: the actions the player controller
// read, the pointer samples it resolved, and the game time the game mode
// carried the chain forward by. A batch is those transitions accumulated —
// the state they reached, the cues they raised between them, and one report per
// chain step that resolved. `src/controller.ts` builds one, `src/frame.ts`
// builds one and merges the controller's into it, and `src/debug.ts` reports a
// single posed transition through the same `reportFor`.
//
// TWO THINGS HERE EXIST TO SERVE THE PRESENTATION, and both keep decoration out
// of the state.
//
//   * `reportFor` re-derives WHICH cells a chain step cleared and created, from
//     the core's own R5, R6, and R8 over the board that step actually read. The
//     core reports THAT a step cleared something; a shatter sheet needs the
//     cells, and `specs/instrumentation.md` rests on the state being
//     reproducible from a seed and a delta, so a decorative detail does not
//     belong in it. It is always given the two states either side of ONE
//     transition, so the board it reads is the board that step read.
//   * `advanceTime` slices a frame's delta into pieces no longer than one
//     `STEP_SECONDS`, so no slice can cross more than one chain step and every
//     step that runs can be reported — even from a single long frame. Every
//     timer in this game is a linear accumulator, so the same interval reaches
//     the same state however it is divided, and the slicing changes nothing
//     about what the core resolves.

import { MAX_STRAIN, STEP_SECONDS } from "./constants";
import type { StepReport } from "./effects";
import {
  applySwap,
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
}

/** A batch that has done nothing yet. */
export function openBatch(state: CoreState): StepBatch {
  return { state, events: NO_EVENTS, steps: [], rung: 0 };
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
  batch.state = next.state;
  batch.events = mergeEvents(batch.events, next.events);
  return batch;
}

/**
 * What the chain step between `before` and `after` cleared and created, or
 * `null` when no step resolved.
 *
 * Re-derived from the core's own R5, R6, and R8 over the board the step read:
 * the ordinary board for a step the cadence set off, and the board AFTER the
 * exchange for step `1` of a chain a swap began — which is also the only step
 * that can be seeded from a prism.
 */
export function reportFor(
  before: CoreState,
  after: CoreState,
): StepReport | null {
  if (after.chainStep <= before.chainStep) return null;
  const swap = after.chainSwap;
  const begun =
    before.chainStep === 0 && after.chainStep === 1 && swap !== null;
  const board = begun ? applySwap(before.board, swap) : before.board;
  const seed = begun
    ? (prismSeed(board, swap) ?? seedFromRuns(board))
    : seedFromRuns(board);
  const cleared = expandClearSet(board, seed.cells);
  return {
    cleared: cellsIn(board, cleared).map((cell) => {
      const gem = gemAt(board, cell);
      return {
        col: cell.col,
        row: cell.row,
        kind: gem?.kind ?? null,
        flawed: (gem?.strain ?? 0) >= MAX_STRAIN,
      };
    }),
    created: creationsFor(seed.runs, swap).map((creation) => creation.cell),
  };
}

/**
 * A batch carried forward by `dt` of game time, in slices no longer than one
 * `STEP_SECONDS`. See the header for why the slicing is here and why it changes
 * nothing about the state the core reaches.
 */
export function advanceTime(batch: StepBatch, dt: number): StepBatch {
  let remaining = dt;
  let slices = 0;
  while (remaining > 0) {
    slices += 1;
    const slice =
      batch.state.phase === "resolving" && slices < MAX_SLICES
        ? Math.min(remaining, STEP_SECONDS)
        : remaining;
    fold(batch, tick(batch.state, slice));
    remaining -= slice;
  }
  return batch;
}
