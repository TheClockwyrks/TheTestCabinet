// Meltdown — the game: the state contract, the per-frame update, and the three
// functions the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the
// game hands to the engine. `initialize` runs once and returns the state and
// the surface together as `[state, debug]`. `update` and `render` then run once
// each per frame — `update` first, with the frame's delta time in SECONDS, then
// `render`. The state is the only channel between them, and it is a VALUE: the
// engine hands `update` the current state as a `DeepReadonly` view and stores
// what it returns, and `render` draws that.
//
// THE STATE SHAPE BELOW IS A CONTRACT (specs/state.md), written here exactly as
// that file declares it. It is what the debug surface in `src/debug.ts` poses
// and reads, and what this case's checks read back. Every field is `readonly`
// and every array is a `readonly` array, so the declared type and the
// `DeepReadonly` view the engine hands out are the same shape and a transition
// spreads one state into the next without a cast. Nothing authoritative lives
// anywhere else: every other module is arithmetic over the record below, and
// the surface's `reset` restores exactly these fields.
//
// ON MUTE. specs/state.md calls `muted` the game's readable copy of the
// runtime's mute bit, refreshed every update, and specs/instrumentation.md
// states there is no `setMuted`: a pose is `(state, ...) => state` and can
// reach no audio bus. The mute ACTION and the panel's mute control are
// therefore the two things that move it, both of which land in this state, and
// `update` pushes the bit onto the engine's bus before it plays a cue and
// mirrors the bus back afterwards — so the field and the bus are equal at the
// end of every frame, which is what makes the snapshot's `muted` the bit the
// runtime holds.

import { armType, rotateHeld, sellAt, upgradeAt } from "./build";
import { defineCues, playFrameEvents } from "./audio";
import { createDebugApi, type MeltdownDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import {
  back,
  confirmMenu,
  createInitialState,
  moveMenu,
  togglePause,
} from "./flow";
import { armIndexOf, readActions, registerActions, type Edges } from "./input";
import {
  pointerDown,
  pointerMove,
  pointerUp,
  type PointerEvents,
} from "./pointer";
import { renderGame } from "./render";
import { send } from "./run";
import { noEvents, stepSimulation, type FrameEvents } from "./sim";
import { COLOR } from "./theme";
import { ACTIONS, TOWER_TYPES } from "./constants";
import type {
  DifficultyName,
  ModeName,
  SurgeType,
  TowerType,
  VentName,
} from "./constants";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { MeltdownDebugApi };

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage match the reactor itself.
 */
export const BACKGROUND: string = COLOR.bg;

// ---- The state contract (specs/state.md) ---------------------------------

export type Screen =
  | "title"
  | "modeselect"
  | "difficultyselect"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

export type Phase = "opening" | "building" | "wave";

export interface TowerState {
  readonly id: number;
  readonly type: TowerType;
  readonly col: number;
  readonly row: number;
  readonly rotation: number;
  readonly level: number;
  readonly heat: number;
  readonly tripped: boolean;
  readonly tripTimer: number;
  readonly fireClock: number;
  readonly targeting: number | null;
  readonly firing: boolean;
  readonly kills: number;
  readonly damageDealt: number;
  readonly spent: number;
  readonly fresh: boolean;
  readonly firingEnabled: boolean;
  readonly thermalEnabled: boolean;
}

export interface UnitState {
  readonly id: number;
  readonly type: SurgeType;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly slowFactor: number;
  readonly slowTimer: number;
  readonly vent: VentName;
  readonly motion: boolean;
}

export interface BuildState {
  readonly type: TowerType;
  readonly col: number;
  readonly row: number;
  readonly rotation: number;
}

export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

export interface MeltdownState {
  readonly screen: Screen;
  readonly phase: Phase;
  readonly menuIndex: number;

  readonly mode: ModeName;
  readonly difficulty: DifficultyName;
  readonly money: number;
  readonly lives: number;
  readonly score: number;
  readonly wave: number;

  readonly buildTimer: number;
  readonly wavePending: number;
  readonly spawnClock: number;
  readonly speed: number;

  readonly towers: readonly TowerState[];
  readonly surge: readonly UnitState[];

  readonly selected: number | null;
  readonly hoverShop: TowerType | null;
  readonly build: BuildState | null;

  readonly waveSpawning: boolean;
  readonly pointer: PointerState;
  readonly muted: boolean;

  readonly nextId: number;
  readonly simTime: number;
  readonly rngState: number;
}

// ---- Actions -------------------------------------------------------------

/** The rows of a menu screen, driven by the four-way pad and `confirm`. */
function menuScreenInput(
  state: MeltdownState,
  edges: Edges,
  events: FrameEvents,
): MeltdownState {
  if (edges.back) return back(state);
  if (edges.pause && state.screen === "paused") return togglePause(state);
  let next = state;
  if (edges.up || edges.left) next = moveMenu(next, -1);
  else if (edges.down || edges.right) next = moveMenu(next, 1);
  if (next.menuIndex !== state.menuIndex) events.menu = true;
  if (edges.confirm) next = confirmMenu(next);
  return next;
}

/** Everything the keyboard does while the game is being played. */
function playingInput(
  state: MeltdownState,
  edges: Edges,
  events: FrameEvents,
): MeltdownState {
  let next = state;
  if (edges.back) return back(next);
  if (edges.pause) return togglePause(next);

  for (const action of ACTIONS) {
    const index = armIndexOf(action);
    if (index !== null && edges[action]) {
      next = armType(next, TOWER_TYPES[index] as TowerType);
    }
  }
  if (edges.rotate) next = rotateHeld(next);
  if (edges.send) next = send(next).state;
  if (edges.speed) next = { ...next, speed: next.speed === 1 ? 2 : 1 };
  if (edges.upgrade && next.selected !== null) {
    next = upgradeAt(next, next.selected).state;
  }
  if (edges.sell && next.selected !== null) {
    const result = sellAt(next, next.selected);
    next = result.state;
    if (result.sold) events.sell = true;
  }
  return next;
}

/** Read this frame's action edges once, and act on them. */
function handleInput(
  state: MeltdownState,
  api: UpdateApi,
  events: FrameEvents,
): MeltdownState {
  const edges = readActions(api);
  // Mute works on every screen, so it is resolved before the per-screen switch.
  const base = edges.mute ? { ...state, muted: !state.muted } : state;
  switch (base.screen) {
    case "playing":
      return playingInput(base, edges, events);
    case "howto":
      return edges.back ? back(base) : base;
    default:
      return menuScreenInput(base, edges, events);
  }
}

/**
 * Resolve this frame's pointer samples one at a time, in arrival order, so a
 * sweep that crossed several tiles between two frames carries the preview
 * across each of them rather than jumping to the last position.
 */
function handlePointer(
  state: MeltdownState,
  api: UpdateApi,
  events: FrameEvents,
): MeltdownState {
  let next = state;
  for (const sample of api.input.pointerSamples()) {
    const result =
      sample.type === "down"
        ? pointerDown(next, sample.x, sample.y)
        : sample.type === "move"
          ? pointerMove(next, sample.x, sample.y)
          : pointerUp(next);
    next = result.state;
    merge(events, result.events);
  }
  return next;
}

function merge(events: FrameEvents, from: PointerEvents): void {
  events.place = events.place || from.place;
  events.sell = events.sell || from.sell;
  events.menu = events.menu || from.menu;
}

// ---- The game the engine drives ------------------------------------------

export const game: Game<MeltdownState, MeltdownDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its bindings,
   * define the ten cues, register the diagnostic sources, build the complete
   * title-screen state, and return it beside the debug surface.
   *
   * Neither the diagnostics nor the surface holds the state: a source is handed
   * the state current at the read, and every operation on the surface takes the
   * state it poses and returns the next one (specs/instrumentation.md).
   */
  initialize(api: InitApi<MeltdownState>): [MeltdownState, MeltdownDebugApi] {
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
   * simulation then advances by the frame's GAME time, which is `dt` multiplied
   * by the game speed and is zero on every screen but `playing`, so a paused
   * floor does not move and `simTime` holds where it was.
   */
  update(
    state: DeepReadonly<MeltdownState>,
    api: UpdateApi,
    dt: number,
  ): MeltdownState {
    const events = noEvents();
    const acted = handleInput(state as MeltdownState, api, events);
    const pointed = handlePointer(acted, api, events);

    const gameDt = pointed.screen === "playing" ? dt * pointed.speed : 0;
    const stepped =
      gameDt > 0 || pointed.screen === "playing"
        ? stepSimulation(pointed, gameDt, events)
        : pointed;

    if (api.audio.muted() !== stepped.muted) api.audio.setMuted(stepped.muted);
    playFrameEvents(api, events);

    return {
      ...stepped,
      pointer: { ...api.input.pointer() },
      muted: api.audio.muted(),
      simTime: stepped.simTime + gameDt,
    };
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: DeepReadonly<MeltdownState>, api: RenderApi): void {
    renderGame(state as MeltdownState, api.ctx);
  },
};
