// Refract — the game: the state contract, the per-frame update, and the binding
// of the three functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the
// game hands to the engine. `initialize` runs once and returns the state and
// the surface together as `[state, debug]`. `update` and `render` then run once
// each per frame — `update` first, with the frame's delta time in SECONDS, then
// `render`. The state is the only channel between them, and it is a VALUE: the
// engine hands `update` the current state as a `DeepReadonly` view and stores
// what it returns, and `render` draws that. Nothing in this build writes to a
// state it was handed; every function over the state is a transition, current
// state in and next state out, built by spreading what it keeps around what it
// changes.
//
// THE STATE SHAPE BELOW IS A CONTRACT (specs/state.md). It is what the debug
// surface in `src/debug.ts` reads and poses, and what this case's checks read
// back. Every field is declared here under its declared name, type, and
// meaning; `initialize` builds the whole state in one go, so no field is
// optional; nothing authoritative lives anywhere else — every other module is
// arithmetic over the record below, and `reset()` on the debug surface restores
// exactly these fields. Every field is `readonly` and every array is a
// `readonly` array, so the declared type and the `DeepReadonly` view the engine
// hands out are the same shape and a transition spreads a state into the next
// one without a cast.

import { defineCues, playFrameEvents, type FrameEvents } from "./audio";
import { createDebugApi, type RefractDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import {
  campaignSolvedItems,
  confirmItem,
  createInitialState,
  enterSelected,
  goBack,
} from "./flow";
import {
  back,
  clearPressed,
  confirm,
  down,
  left,
  mutePressed,
  registerActions,
  right,
  up,
} from "./input";
import { renderGame } from "./render";
import { COLOR } from "./theme";
import { pointerDown, pointerMove, pointerUp } from "./pointer";
import {
  clearBeams,
  mergeEvents,
  NO_EVENTS,
  type TraceEvents,
} from "./tracing";
import { CAMPAIGN_LENGTH, SOLVED_ITEMS, TITLE_ITEMS } from "./constants";
import { COMPLETE_ITEMS, SELECT_COLS } from "./layout";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { RefractDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the bench.
 */
export const BACKGROUND: string = COLOR.bg;

// ---- The state contract (specs/state.md) ---------------------------------

export type Screen =
  "title" | "howto" | "select" | "playing" | "solved" | "complete";

export type Mode = "campaign" | "cascade";

export type Channel = "triangle" | "square" | "diamond";

export type NodeKind = "emitter" | "lens" | "crystal";

export interface Cell {
  readonly col: number;
  readonly row: number;
}

export interface NodeState {
  readonly col: number;
  readonly row: number;
  readonly kind: NodeKind;
  readonly channel: Channel | null;
  readonly charges: number | null;
}

export interface BoardState {
  readonly cols: number;
  readonly rows: number;
  readonly nodes: readonly NodeState[];
}

export interface BeamState {
  readonly channel: Channel;
  readonly cells: readonly Cell[];
}

export interface TraceState {
  readonly channel: Channel;
}

export type PointerDevice = "mouse" | "pen" | "touch";

export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
  readonly device: PointerDevice;
}

export interface RefractState {
  readonly screen: Screen;
  readonly mode: Mode;
  readonly menuIndex: number;

  readonly board: BoardState;
  readonly beams: readonly BeamState[];
  readonly tracing: TraceState | null;

  readonly boardIndex: number;
  readonly solvedBoards: readonly number[];
  readonly unlockedCount: number;
  readonly selectIndex: number;

  readonly solvedCount: number;
  readonly tier: number;

  readonly pointer: PointerState;
  readonly armedTarget: string | null;
  readonly simTime: number;
  readonly muted: boolean;
  readonly rngState: number;
}

// ---- Menus (one edge read per action per frame) --------------------------

/** The next index on a vertical menu, wrapping at both ends. */
function wrap(index: number, delta: number, count: number): number {
  return (index + delta + count) % count;
}

/**
 * A vertical menu's frame: `up` and `down` move the highlight, `confirm`
 * accepts it. All three edges are read before any is acted on, so exactly one
 * press moves or accepts and nothing is left armed for a later frame.
 *
 * `confirm` and the pointer's `menu-<i>` targets both reach `confirmItem` in
 * `src/flow.ts`, so a choice means the same thing however it was made
 * (specs/controls.md).
 */
function menuInput(
  state: RefractState,
  api: UpdateApi,
  count: number,
): RefractState {
  const moveUp = up(api);
  const moveDown = down(api);
  const accepted = confirm(api);
  if (moveUp) return { ...state, menuIndex: wrap(state.menuIndex, -1, count) };
  if (moveDown) return { ...state, menuIndex: wrap(state.menuIndex, 1, count) };
  if (accepted) return confirmItem(state, state.menuIndex);
  return state;
}

/**
 * The select grid: `SELECT_COLS` columns by `SELECT_ROWS` rows of campaign
 * boards. `left`/`right` wrap within the row, `up`/`down` wrap between rows in
 * the same column (specs/modes/campaign.md).
 */
const SELECT_ROWS = CAMPAIGN_LENGTH / SELECT_COLS;

function selectInput(state: RefractState, api: UpdateApi): RefractState {
  const moveLeft = left(api);
  const moveRight = right(api);
  const moveUp = up(api);
  const moveDown = down(api);
  const accepted = confirm(api);
  const leave = back(api);
  if (leave) return goBack(state);

  const col = state.selectIndex % SELECT_COLS;
  const row = Math.floor(state.selectIndex / SELECT_COLS);
  let nextCol = col;
  let nextRow = row;
  if (moveLeft) nextCol = wrap(col, -1, SELECT_COLS);
  else if (moveRight) nextCol = wrap(col, 1, SELECT_COLS);
  else if (moveUp) nextRow = wrap(row, -1, SELECT_ROWS);
  else if (moveDown) nextRow = wrap(row, 1, SELECT_ROWS);
  const index = nextRow * SELECT_COLS + nextCol;
  if (index !== state.selectIndex) return { ...state, selectIndex: index };

  // `confirm` on a locked board does nothing and leaves the highlight put,
  // which `enterSelected` is what decides (specs/modes/campaign.md).
  if (accepted) return enterSelected(state);
  return state;
}

// ---- Edge input (once per frame) -----------------------------------------

/**
 * Read this frame's one-shot actions and act on them.
 *
 * Every action edge read in Refract happens here, once, which is what the
 * engine's consume-on-read edges ask for: two readers of the same action in one
 * frame would split one press between them. The pointer's samples are handled
 * separately, in `handlePointer`.
 */
function handleInput(
  state: RefractState,
  api: UpdateApi,
  events: { clear: boolean },
): RefractState {
  // Mute works on every screen, so it is read before the per-screen switch.
  if (mutePressed(api)) api.audio.setMuted(!api.audio.muted());

  switch (state.screen) {
    case "title":
      return menuInput(state, api, TITLE_ITEMS.length);
    case "howto":
      return back(api) ? goBack(state) : state;
    case "select":
      return selectInput(state, api);
    case "playing": {
      // Both edges are read before either is acted on. `back` leaves the
      // board — to the grid in Campaign, to the title in Cascade — and the
      // beams drawn on it are discarded either way.
      const leave = back(api);
      const clearNow = clearPressed(api);
      if (leave) return goBack(state);
      if (clearNow) {
        const { state: next, cleared } = clearBeams(state);
        events.clear = events.clear || cleared;
        return next;
      }
      return state;
    }
    case "solved": {
      if (back(api)) return goBack(state);
      const count =
        state.mode === "campaign"
          ? campaignSolvedItems(state.boardIndex).length
          : SOLVED_ITEMS.length;
      return menuInput(state, api, count);
    }
    case "complete":
      if (back(api)) return goBack(state);
      return menuInput(state, api, COMPLETE_ITEMS.length);
  }
}

// ---- The pointer (every sample, in arrival order) ------------------------

/**
 * Resolve this frame's pointer samples one at a time, in the order they
 * arrived, so a sweep that crossed several cells between two frames grows or
 * unwinds the beam node by node rather than jumping to the last position
 * (specs/controls.md). Each sample's own trace events are merged into the
 * frame's, so one cue plays per kind of event however many samples raised it.
 */
function handlePointer(
  state: RefractState,
  api: UpdateApi,
): { state: RefractState; events: TraceEvents } {
  let next = state;
  let events = NO_EVENTS;
  for (const sample of api.input.pointerSamples()) {
    // The primary pointer alone operates the game, so a second finger resting
    // on a touchscreen changes nothing (specs/controls.md, The pointer).
    if (!sample.primary) continue;
    const result =
      sample.type === "down"
        ? pointerDown(next, sample.x, sample.y, sample.device)
        : sample.type === "move"
          ? pointerMove(next, sample.x, sample.y, sample.device)
          : pointerUp(next, sample.device);
    next = result.state;
    events = mergeEvents(events, result.events);
  }
  return { state: next, events };
}

// ---- The game the engine drives ------------------------------------------

export const game: Game<RefractState, RefractDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the five cues, register the diagnostic sources, build the complete
   * initial state, and return it beside the debug surface.
   *
   * Neither the diagnostics nor the surface holds the state: a source is handed
   * the state current at the read, and every operation on the surface takes the
   * state it poses and returns the next one (specs/instrumentation.md).
   */
  initialize(api: InitApi<RefractState>): [RefractState, RefractDebugApi] {
    registerActions(api);
    defineCues(api);
    registerDiagnostics(api);
    return [createInitialState(), createDebugApi()];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * The action edges are read first — they are news for exactly one frame — and
   * the pointer's samples are resolved after them, each in arrival order. The
   * cues an event raised are played once each at the end of the frame, and the
   * pointer mirror, the mute mirror, and the clock are refreshed on the state
   * the frame leaves behind, whatever the screen (specs/state.md).
   */
  update(
    state: DeepReadonly<RefractState>,
    api: UpdateApi,
    dt: number,
  ): RefractState {
    const frame: FrameEvents = {
      connect: false,
      retract: false,
      channelComplete: false,
      solved: false,
      clear: false,
    };
    const acted = handleInput(state, api, frame);
    const { state: traced, events } = handlePointer(acted, api);
    frame.connect = events.connect;
    frame.retract = events.retract;
    frame.channelComplete = events.channelComplete;
    frame.solved = events.solved;
    frame.clear = frame.clear || events.cleared;
    playFrameEvents(api, frame);

    // `pointer` is written by the resolution every sample goes through, so it
    // already holds what this frame read — and a scenario posed through the
    // debug surface, which feeds that same path, survives the frame that
    // follows it (specs/instrumentation.md).
    return {
      ...traced,
      muted: api.audio.muted(),
      simTime: traced.simTime + dt,
    };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: DeepReadonly<RefractState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
