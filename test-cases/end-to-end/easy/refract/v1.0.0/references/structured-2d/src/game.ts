// Refract — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session. `RefractInstance.initialize` runs once, before the level opens —
// register the actions, define the cues, and return the debug surface, which
// the engine holds and returns from `engine.debug`. `RefractMode` runs the
// level: its `gameStateClass` is `RefractState`, so the engine builds the state
// below when the world opens; its `beginPlay` adds the single player
// (possessing nothing) whose controller reads the frame's actions and pointer;
// and its `tick` does the per-frame bookkeeping the specification asks of every
// frame, whatever the screen.
//
// THE STATE SHAPE BELOW IS A CONTRACT (specs/state.md). It is the world's game
// state — `engine.world.state` is the one instance of it — and the framework's
// states are LIVE objects: a tick writes the fields it advances in place, and
// each field initializer is that field's title-screen value, the same value the
// debug surface's `reset` restores. It is the whole of the authoritative game:
// every value carried from one frame to the next lives on it, nothing is kept
// in a module-level variable or a closure, and every other module is either
// arithmetic over these fields or a system that writes them through the paths
// play runs on. Refract's screens run on `screen` rather than the match phase:
// the mode never calls `setPhase`, so the inherited `phase` stays `"waiting"`
// and `elapsed` stays `0`.

import { GameInstance, GameMode, GameState } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi, World } from "@clockwyrks/structured-2d";
import { defineCues } from "./audio";
import { Bench } from "./bench";
import { DEFAULT_SEED } from "./constants";
import { RefractController } from "./controller";
import { createDebugApi, type RefractDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { registerActions } from "./input";
import { COLOR } from "./theme";

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
  col: number;
  row: number;
}

export interface NodeState {
  col: number;
  row: number;
  kind: NodeKind;
  channel: Channel | null;
  charges: number | null;
}

export interface BoardState {
  cols: number;
  rows: number;
  nodes: NodeState[];
}

export interface BeamState {
  channel: Channel;
  cells: Cell[];
}

export interface TraceState {
  channel: Channel;
}

export type PointerDevice = "mouse" | "pen" | "touch";

export interface PointerState {
  x: number;
  y: number;
  down: boolean;
  device: PointerDevice;
}

export class RefractState extends GameState {
  screen: Screen = "title";
  mode: Mode = "campaign";
  menuIndex = 0;

  board: BoardState = { cols: 0, rows: 0, nodes: [] };
  beams: BeamState[] = [];
  tracing: TraceState | null = null;

  boardIndex = 0;
  solvedBoards: number[] = [];
  unlockedCount = 1;
  selectIndex = 0;

  solvedCount = 0;
  tier = 1;

  pointer: PointerState = { x: 0, y: 0, down: false, device: "mouse" };
  armedTarget: string | null = null;
  simTime = 0;
  muted = false;
  rngState = DEFAULT_SEED;
}

/**
 * The open world's state, as the state it is: the mode names `RefractState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error instead of a silent cast.
 */
export function refractState(world: World): RefractState {
  const state = world.state;
  if (!(state instanceof RefractState)) {
    throw new Error("Refract: the open world does not hold a RefractState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) ---------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens: it registers every
 * action against its bindings, defines the five cues, and returns the debug
 * surface `specs/instrumentation.md` fixes. The surface reads the live world
 * off the engine at each call, so it holds no state of its own.
 */
class RefractInstance extends GameInstance<RefractDebugApi> {
  override initialize(api: InitApi): RefractDebugApi {
    registerActions(api);
    defineCues(api);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the pointer
 * and the menus drive state rather than a pawn — and registers the diagnostic
 * sources with the world's overlay registry. The screen machine itself runs in
 * that player's controller (the actions and the pointer are read there) and in
 * `src/flow.ts`; the tick below is the bookkeeping every frame owes the state,
 * whatever the screen (specs/state.md, specs/ui.md).
 */
class RefractMode extends GameMode {
  override gameStateClass = RefractState;
  override playerControllerClass = RefractController;

  override beginPlay(): void {
    // `pawnClass` stays `null`, so the one player possesses nothing; its
    // controller is where the frame's actions and pointer samples are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = refractState(this.world);
    // Accumulated simulation time, on every screen; `dt` is already seconds.
    state.simTime += dt;
    // The game's readable copy of the engine's mute bit, refreshed each frame.
    state.muted = this.world.audio.muted();
  }
}

/**
 * The game this build's engine drives: the instance, the single level, and the
 * name `engine.initialize` opens it under. `src/main.ts` binds it to the
 * engine; the actors the level declares draw the state the mode advances.
 */
export const game: GameDefinition<RefractDebugApi> = {
  instance: RefractInstance,
  levels: { bench: { mode: RefractMode, actors: [{ type: Bench }] } },
  startLevel: "bench",
};
