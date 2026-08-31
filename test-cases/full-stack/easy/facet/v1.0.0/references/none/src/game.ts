// Facet — the game the runtime drives: the per-frame update, the binding of
// the three functions, and the one thing this build adds on top of the core.
//
// THE STATE AND THE RULES ARE THE CORE'S. `src/core/` is Facet's whole
// simulation — the board, R1 to R9, the chain cadence, the screens, and the
// pose logic behind the debug surface — written against nothing but the
// figures in `src/constants.ts`. This file does not restate any of it. It
// reads the frame's input, hands the core the frame's delta time, plays the
// cues the frame raised, and mirrors the three fields `specs/state.md` says the
// game keeps honest every frame: the pointer, the mute bit, and `simTime`
// (which the core's `tick` accumulates).
//
// WHAT THIS FILE ADDS is the bridge from the simulation to the presentation.
// The core reports THAT a step cleared something; the shatter sheets and the
// particle bursts need to know WHICH cells, and putting that in the state would
// make a decorative detail part of the contract `specs/instrumentation.md`
// rests on. So `reportFor` re-derives it from the core's own rule functions,
// over the board the step actually read — the same seed, the same R6 closure,
// the same R8 creations — and `advanceTime` slices the frame's delta so that no
// slice can cross more than one chain step, which is what lets every step of a
// chain be reported even from a single long frame such as `advance(1, 1)`.

import { defineCues, playFrameEvents } from "./audio";
import { createDebugApi, type FacetDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { Presentation, type StepReport } from "./effects";
import {
  back,
  confirm,
  down,
  left,
  mute,
  pause,
  registerActions,
  right,
  up,
} from "./input";
import { renderGame } from "./render";
import { COLOR } from "./theme";
import { MAX_STRAIN, STEP_SECONDS } from "./constants";
import {
  applySwap,
  cellsIn,
  confirm as confirmAction,
  createInitialState,
  creationsFor,
  expandClearSet,
  gemAt,
  goBack,
  mergeEvents,
  moveHorizontal,
  moveVertical,
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
  type FacetState,
  type Stepped,
} from "./core";
import type { AssetStore } from "./assets";
import type {
  Game,
  InitApi,
  RenderApi,
  ScratchCanvas,
  UpdateApi,
} from "./runtime";

// The debug surface is part of the module contract and is declared beside the
// game it types, so the type is exported from here whichever module builds it.
export type { FacetDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the runtime as the color the
 * canvas is cleared to each frame, so the letterbox bars match the bench.
 */
export const BACKGROUND: string = COLOR.bg;

/**
 * The most slices one frame's delta is cut into before the rest of it is run
 * in one go. A frame is normally worth well under one `STEP_SECONDS`, so this
 * only bites on an absurd `advance(seconds, 1)`, where losing the per-step
 * effect reports of the tail is the right trade against a hung tab.
 */
const MAX_SLICES = 512;

/** What one frame accumulated: the state, its cues, and its chain steps. */
interface FrameOutcome {
  state: FacetState;
  events: FacetEvents;
  /** One entry per chain step that resolved this frame, in order. */
  steps: StepReport[];
  /** The highest multiplier any of those steps scored at; the ladder rung. */
  rung: number;
}

/** A frame that has done nothing yet. */
function openFrame(state: FacetState): FrameOutcome {
  return { state, events: NO_EVENTS, steps: [], rung: 0 };
}

/**
 * Fold one core transition into the frame: its next state, its cues, and the
 * chain step it resolved, if it resolved one.
 */
function fold(outcome: FrameOutcome, next: Stepped): FrameOutcome {
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
 * What the chain step between `before` and `after` cleared and created, or
 * `null` when no step resolved.
 *
 * Re-derived rather than reported, from the core's own R5, R6, and R8 over the
 * board the step read: the ordinary board for a step the cadence set off, and
 * the board AFTER the exchange for step `1` of a chain a swap began — which is
 * also the only step that can be seeded from a prism.
 */
export function reportFor(
  before: FacetState,
  after: FacetState,
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

// ---- Input ---------------------------------------------------------------

/**
 * This frame's action edges, acted on.
 *
 * Every edge is read BEFORE any is acted on, because the keyboard consumes an
 * edge on the first read and an action left armed would be discarded at the end
 * of the frame rather than surfacing on the next one. Each armed action is then
 * applied in turn, in the order below, to the state the one before it left — so
 * a frame carrying both an arrow and a `confirm` moves the cursor and then acts
 * on the cell it moved to, which is what a player who pressed both between two
 * repaints meant, and what a scenario driving the menus with real key events
 * gets whether or not a frame happened to fall between its presses.
 *
 * `mute` is not one of them: it is read on every screen and it changes the
 * runtime's bus rather than the state.
 */
function handleInput(state: FacetState, api: UpdateApi): Stepped {
  const moveUp = up(api);
  const moveDown = down(api);
  const moveLeft = left(api);
  const moveRight = right(api);
  const accept = confirm(api);
  const leave = back(api);
  const held = pause(api);
  if (mute(api)) api.audio.setMuted(!api.audio.muted());

  let current = state;
  let events = NO_EVENTS;
  const act = (next: Stepped): void => {
    current = next.state;
    events = mergeEvents(events, next.events);
  };

  if (held) act(quiet(togglePause(current)));
  if (leave) act(quiet(goBack(current)));
  if (moveUp) act(quiet(moveVertical(current, -1)));
  if (moveDown) act(quiet(moveVertical(current, 1)));
  if (moveLeft) act(quiet(moveHorizontal(current, -1)));
  if (moveRight) act(quiet(moveHorizontal(current, 1)));
  if (accept) act(confirmAction(current));
  return { state: current, events };
}

/**
 * This frame's pointer samples, resolved one at a time in arrival order
 * (specs/controls.md), each through the very path a posed press takes.
 */
function handlePointer(outcome: FrameOutcome, api: UpdateApi): FrameOutcome {
  for (const sample of api.input.pointerSamples()) {
    const next =
      sample.type === "down"
        ? pointerDown(outcome.state, sample.x, sample.y)
        : sample.type === "move"
          ? pointerMove(outcome.state, sample.x, sample.y)
          : quiet(pointerUp(outcome.state));
    fold(outcome, next);
  }
  return outcome;
}

/**
 * The frame's game time, run through the core in slices no longer than one
 * `STEP_SECONDS`.
 *
 * The core resolves as many chain steps as the delta covers, in one call. The
 * slicing changes nothing about what it resolves — every timer in this game is
 * a linear accumulator, so the same interval reaches the same state however it
 * is divided — and it is what lets EVERY step that runs be handed to the
 * presentation, rather than only the first.
 */
function advanceTime(outcome: FrameOutcome, dt: number): FrameOutcome {
  let remaining = dt;
  let slices = 0;
  while (remaining > 0) {
    slices += 1;
    const slice =
      outcome.state.phase === "resolving" && slices < MAX_SLICES
        ? Math.min(remaining, STEP_SECONDS)
        : remaining;
    fold(outcome, tick(outcome.state, slice));
    remaining -= slice;
  }
  return outcome;
}

// ---- The game the runtime drives -----------------------------------------

/**
 * Build the game over one presentation layer.
 *
 * The presentation is constructed per game rather than held at module scope,
 * so a test stands up a whole game of its own without inheriting the effects
 * another one left flying.
 */
export function createGame(
  scratch: ScratchCanvas,
): Game<FacetState, FacetDebugApi> {
  const presentation = new Presentation(scratch);
  let assets: AssetStore | null = null;
  /**
   * The state the previous frame left.
   *
   * The debug surface poses BETWEEN frames — `requestSwap`, and the three
   * pointer operations, each resolve a chain step the moment they are called —
   * so a frame that only compared the state it was handed against itself would
   * show none of what a posed scenario did. Holding the last frame's state lets
   * the same `reportFor` cover the gap between two frames as well as the work
   * inside one.
   */
  let seen: FacetState | null = null;

  return {
    /**
     * Runs once, before any frame: register every action against its
     * bindings, declare the eight cues over the produced sounds, register the
     * diagnostic sources, build the complete initial state, and return it
     * beside the debug surface.
     *
     * Neither the diagnostics nor the surface holds the state: a source is
     * handed the state current at the read, and every operation on the surface
     * takes the state it poses and returns the next one
     * (specs/instrumentation.md).
     */
    initialize(api: InitApi<FacetState>): [FacetState, FacetDebugApi] {
      registerActions(api);
      defineCues(api);
      registerDiagnostics(api);
      assets = api.assets;
      return [createInitialState(), createDebugApi()];
    },

    /**
     * Runs once per frame, before `render`: the next state, from the current
     * one.
     *
     * The action edges are read first — they are news for exactly one frame —
     * then the pointer's samples in arrival order, then the frame's game time.
     * The cues those raised are played once each at the end, the presentation
     * is handed the frame's chain steps, and the pointer mirror and the mute
     * mirror are refreshed on the state the frame leaves behind, whatever the
     * screen (specs/state.md).
     */
    update(state: FacetState, api: UpdateApi, dt: number): FacetState {
      // Whatever a pose did between this frame and the last one, reported the
      // same way a transition inside the frame is.
      const previous = seen ?? state;
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

      if (assets !== null) {
        presentation.observe(
          previous.board,
          outcome.state.board,
          outcome.steps,
          assets,
        );
      }
      // A completed level deals a whole new board, so whatever is still flying
      // belongs to a board that is gone.
      if (outcome.events.levelUp) presentation.clear();
      presentation.advance(dt);

      const next: FacetState = {
        ...outcome.state,
        pointer: api.input.pointer(),
        muted: api.audio.muted(),
      };
      seen = next;
      return next;
    },

    /** Runs once per frame, after `update`. Draws the state it is handed. */
    render(state: FacetState, api: RenderApi): void {
      renderGame(state, api.ctx, api.assets, presentation);
    },
  };
}
