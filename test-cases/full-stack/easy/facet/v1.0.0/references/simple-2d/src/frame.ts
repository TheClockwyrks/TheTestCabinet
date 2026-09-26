// Facet — one frame: the input read, the pointer resolved, the game time run,
// the cues played, and the effects a chain threw handed to the presentation.
//
// The core does the simulating. What is here is everything a frame is that a
// rule is not, and one thing this build adds on top: THE BRIDGE FROM THE
// SIMULATION TO THE PRESENTATION.
//
// The core reports THAT a step cleared something; the shatter sheets and the
// particle bursts need to know WHICH cells, and at WHICH WAVE each of them
// went. Putting that in the state would make a decorative detail part of the
// contract `specs/instrumentation.md` rests on, so `reportFor` re-derives it
// instead, from the core's own rule functions over the board the step actually
// read — the same R5 seed, the same R6 closure and its waves, the same R8
// creations — and `advanceTime` slices the frame's delta so no slice can cross
// more than one chain step, which is what lets EVERY step of a chain be
// reported even out of a single long frame such as `engine.advance` over a
// coarse clock.

import { playFrameEvents } from "./audio";
import { MAX_STRAIN, STEP_SECONDS } from "./constants";
import {
  cellsIn,
  confirm as confirmAction,
  creationsFor,
  expandClearSet,
  gemAt,
  goBack,
  cellKey,
  mergeEvents,
  moveMenu,
  multiplierFor,
  NO_EVENTS,
  pointerDown,
  pointerMove,
  pointerUp,
  prismSeed,
  quiet,
  seedFromRuns,
  tick,
  togglePause,
  type FacetEvents,
  type FacetState as CoreState,
  type Stepped,
} from "./core";
import { pressed } from "./input";
import type { AssetStore } from "./assets";
import type { Presentation, StepReport } from "./effects";
import type { UpdateApi } from "@clockwyrks/simple-2d";

/**
 * The most slices one frame's delta is cut into before the rest of it is run in
 * one go. A frame is normally worth well under one `STEP_SECONDS`, so this only
 * bites on an absurdly coarse clock, where losing the per-step effect reports of
 * the tail is the right trade against a hung tab.
 */
const MAX_SLICES = 512;

/** What one frame accumulated: the state, its cues, and its chain steps. */
export interface FrameOutcome {
  state: CoreState;
  events: FacetEvents;
  /** One entry per chain step that resolved this frame, in order. */
  steps: StepReport[];
  /** The highest multiplier any of those steps scored at; the ladder rung. */
  rung: number;
}

/** A frame that has done nothing yet. */
export function openFrame(state: CoreState): FrameOutcome {
  return { state, events: NO_EVENTS, steps: [], rung: 0 };
}

/**
 * Fold one core transition into the frame: its next state, its cues, and the
 * chain step it resolved, if it resolved one.
 */
export function fold(outcome: FrameOutcome, next: Stepped): FrameOutcome {
  const report = reportFor(outcome.state, next.state);
  if (report !== null) {
    outcome.steps.push(report);
    outcome.rung = Math.max(outcome.rung, multiplierFor(next.state.chainStep));
  }
  outcome.state = next.state;
  outcome.events = mergeEvents(outcome.events, next.events);
  return outcome;
}

/**
 * What the chain step between `before` and `after` cleared and created, and at
 * which wave each cell went, or `null` when no step resolved.
 *
 * Re-derived rather than reported, from the core's own R5, R6, and R8 over the
 * board the step read. An accepted swap exchanges its two cells the moment it is
 * accepted and then travels for `SWAP_SECONDS`, so by the time step `1`
 * resolves the exchange is already on the board `before` holds: the seed is
 * taken from that board as it stands, and the only thing step `1` needs the
 * swap itself for is the prism seed R5 gives it and the placement R8 makes from
 * it.
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
  const seed =
    begun && swap !== null
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
        wave: cleared.waveOf.get(cellKey(cell)) ?? 0,
      };
    }),
    created: creationsFor(seed.runs, swap).map((creation) => creation.cell),
    waves: cleared.waves,
  };
}

// ---- Input ---------------------------------------------------------------

/**
 * This frame's action edges, acted on.
 *
 * Every edge is read BEFORE any is acted on, because the engine consumes an edge
 * on the first read and closes the input frame after the render, so an action
 * left armed would be discarded rather than surfacing on the next frame. Each
 * armed action is then applied in turn, in the order below, to the state the one
 * before it left — so a frame carrying both an arrow and a `confirm` moves the
 * highlight and then takes the item it moved to, which is what a player who
 * pressed both between two repaints meant, and what a scenario driving the menus
 * with real key events gets whether or not a frame happened to fall between its
 * presses.
 *
 * `Escape` fires `pause` AND `back`, so both are applied. The two act on screens
 * that do not overlap — `pause` on `playing` and `paused`, `back` on `howto` and
 * `gameover` — so whichever is applied first, the other finds a screen it does
 * nothing to, and one key raises the pause menu from the board, drops it again,
 * and backs out of every other screen that can be backed out of.
 *
 * `mute` is not one of them: it is read on every screen and it toggles the
 * engine's bus rather than the state, which every frame then mirrors.
 */
export function handleInput(state: CoreState, api: UpdateApi): Stepped {
  const moveUp = pressed(api, "up");
  const moveDown = pressed(api, "down");
  const accept = pressed(api, "confirm");
  const leave = pressed(api, "back");
  const held = pressed(api, "pause");
  if (pressed(api, "mute")) api.audio.setMuted(!api.audio.muted());

  let current = state;
  let events = NO_EVENTS;
  const act = (next: Stepped): void => {
    current = next.state;
    events = mergeEvents(events, next.events);
  };

  if (held) act(quiet(togglePause(current)));
  if (leave) act(quiet(goBack(current)));
  if (moveUp) act(quiet(moveMenu(current, -1)));
  if (moveDown) act(quiet(moveMenu(current, 1)));
  if (accept) act(quiet(confirmAction(current)));
  return { state: current, events };
}

/**
 * This frame's pointer samples, resolved one at a time in arrival order
 * (specs/controls.md), each through the very path a posed press takes — so a
 * sweep that crossed two cells between repaints is read as the carry it was
 * rather than as its last position.
 *
 * The game acts on the PRIMARY pointer alone, so a second finger resting on the
 * screen changes nothing; the device that drove each sample is carried into the
 * core, which is what puts `"mouse"`, `"pen"`, or `"touch"` on the state.
 */
export function handlePointer(
  outcome: FrameOutcome,
  api: UpdateApi,
): FrameOutcome {
  for (const sample of api.input.pointerSamples()) {
    if (!sample.primary) continue;
    if (sample.type === "down") {
      fold(
        outcome,
        pointerDown(outcome.state, sample.x, sample.y, sample.device),
      );
      continue;
    }
    // A release carries a position of its own, and where a release lands is
    // what decides both what it takes and what it plays. The core's release
    // reads the pointer where the state holds it, so the position the release
    // arrived at is resolved as the move it is before the lift is resolved —
    // which is the same two readings a release preceded by a move gives.
    fold(
      outcome,
      pointerMove(outcome.state, sample.x, sample.y, sample.device),
    );
    if (sample.type === "up") {
      fold(outcome, pointerUp(outcome.state, sample.device));
    }
  }
  return outcome;
}

/**
 * The frame's game time, run through the core in slices no longer than one
 * `STEP_SECONDS`.
 *
 * The core resolves the swap in motion and as many chain steps as the delta
 * covers, in one call. The slicing changes nothing about what it resolves —
 * every timer in this game is a linear accumulator, so the same interval
 * reaches the same state however it is divided — and it is what lets every step
 * that runs be handed to the presentation, rather than only the first. It runs
 * while the board is `swapping` as well as while it is `resolving`, because the
 * swap's own step is a step like any other.
 */
export function advanceTime(outcome: FrameOutcome, dt: number): FrameOutcome {
  let remaining = dt;
  let slices = 0;
  while (remaining > 0) {
    slices += 1;
    const slice =
      outcome.state.phase !== "idle" && slices < MAX_SLICES
        ? Math.min(remaining, STEP_SECONDS)
        : remaining;
    fold(outcome, tick(outcome.state, slice));
    remaining -= slice;
  }
  return outcome;
}

// ---- The whole frame -----------------------------------------------------

/**
 * One frame, from the state the engine holds to the state it will hold next.
 *
 * `previous` is the state the last frame left, which is not always the state
 * this frame was handed: the debug surface poses BETWEEN frames, and a posed
 * `requestSwap` or a posed press can put the board somewhere the frame it
 * belongs to never saw. Comparing the two is what lets the presentation show a
 * step a pose resolved, and it is the only use either state is put to beyond
 * the frame itself.
 */
export function runFrame(
  previous: CoreState,
  state: CoreState,
  api: UpdateApi,
  dt: number,
  assets: AssetStore,
  presentation: Presentation,
): CoreState {
  const opened = openFrame(state);
  const posed = reportFor(previous, state);
  if (posed !== null) {
    opened.steps.push(posed);
    opened.rung = Math.max(opened.rung, multiplierFor(state.chainStep));
  }

  const outcome = advanceTime(
    handlePointer(fold(opened, handleInput(state, api)), api),
    dt,
  );

  playFrameEvents(api, outcome.events, outcome.rung, outcome.state.screen);

  presentation.observe(previous, outcome.state, outcome.steps, assets);
  presentation.advance(dt);

  return outcome.state;
}
