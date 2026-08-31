// Facet — the game. This is the file the build implements.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// it holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// First, declare and export `FacetState`, exactly as `specs/state.md` fixes it,
// and `FacetDebugApi`, the debug and automation surface
// `specs/instrumentation.md` specifies. The stub below is written against both
// names, so this project does not compile until they exist. The type check
// failing on a freshly seeded workspace is the starting point, not a broken
// seed.
//
// Then implement the three functions. `initialize` runs once, when the engine is
// initialized, and returns the state and the debug surface together, as the pair
// `[state, debug]`. `update` and `render` then run once each per frame, `update`
// first, with the frame's delta time in seconds, then `render`.
//
// The state is a value, and every frame is a transition over it. The engine
// hands `update` the current state as a read-only view
// (`DeepReadonly<FacetState>`, from `ts-essentials`) and stores whatever
// `update` returns as the next state; `render` is handed that next state, as the
// same read-only view, and returns nothing. Nothing ever holds a writable
// `FacetState`: `update` builds the next state from the current one (spread the
// parts that change, `map` over the cells) rather than assigning into it, and a
// frame that returns `undefined` is refused by the engine. The engine's own
// documentation, seeded at `engine/`, defines all of this and the scoped APIs
// each function receives; read it before you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose takes the current state
// and returns the next (`loadBoard(state, rows)`, `requestSwap(state, colA,
// rowA, colB, rowB)`), a reading takes the state and returns what it read
// (`snapshot(state)`), and a caller drives them through `engine.apply` and
// `engine.state`. Where its implementation lives under `src/` is your call; the
// only fixed point is that `initialize` returns it.
//
// The pointer comes from the engine as well, and it is what the whole game is
// worked with: a gem is taken hold of by pressing on it, offered onto its
// neighbor by pressing or dragging there, and the move is played by the release.
// Every screen carries pointer targets besides, so a player with nothing but a
// touchscreen reaches all of them. The engine hands `update` the pointer's
// position already in logical stage units, along with its press and release
// edges and the device that drove it. The engine's input documentation, seeded
// at `engine/`, defines the API, and `specs/controls.md` states what Facet does
// with them.
//
// The sprites, effects, and sounds are produced, not supplied.
// `specs/assets.md` states what you produce with the asset tools and commit
// under `public/assets/`; `initialize` loads each image with
// `api.assets.loadImage` and binds each cue to its file with `api.audio.load`,
// awaited, so every asset is decoded before the first frame.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the board's surround. This placeholder is replaced by the
 * build with the color its board sits on.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Facet: src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<FacetState, FacetDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, load the produced
   * sprites and particle systems and bind each of the CUES to its produced
   * file, register the diagnostic sources specs/instrumentation.md lists (each
   * is handed the state current at the read, so none closes over the state
   * built here), and build the complete initial state: the title screen over an
   * idle board, with every field of FacetState set exactly as specs/state.md
   * states. Return it beside the debug surface.
   */
  initialize(_api: InitApi<FacetState>): [FacetState, FacetDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `dt` is the real elapsed seconds of this frame, and `simTime` accumulates it
   * on every update whatever the screen. Read the frame's actions and the
   * pointer position and edges, drive the menus and the pointer targets, decide
   * every requested swap by the move rules in specs/rules.md, carry an accepted
   * swap through SWAP_SECONDS and then a chain forward against each step's own
   * hold, play cues on their events, and mirror the engine's mute bit into the
   * returned state's `muted`. The value returned is what `render` draws and what
   * the next `update` receives; `state` itself is read-only and stays as it was.
   */
  update(
    _state: DeepReadonly<FacetState>,
    _api: UpdateApi,
    _dt: number,
  ): FacetState {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned.
   *
   * `api.ctx` arrives cleared and already carrying the logical transform, so
   * draw in 1280x720 coordinates and never read the canvas element's size. Each
   * cell draws at the center specs/board.md fixes, with the readouts, the screens
   * and the pointer targets clear of the board's extent. A swap in motion, a
   * shattering set and a falling gem are each drawn between cells over the spans
   * specs/rules.md gives them. The state arrives read-only, so the type is what
   * guarantees that rendering changes nothing.
   */
  render(_state: DeepReadonly<FacetState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
