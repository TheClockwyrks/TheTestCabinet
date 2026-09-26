// Deepcore — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// it holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// FIRST, DECLARE AND EXPORT `DeepcoreState`, the whole authoritative state the
// specification's rules require of the game, and `DeepcoreDebugApi`, the debug
// and automation surface `specs/instrumentation.md` specifies. The stub below is
// written against both names, so this project does not compile until they exist
// — the type check failing on a freshly seeded workspace is the starting point,
// not a broken seed.
//
// THEN IMPLEMENT the three functions. `initialize` runs once, when the engine is
// initialized, and returns the state and the debug surface together, as the pair
// `[state, debug]`. `update` and `render` then run once each per frame — `update`
// first, with the frame's delta time in SECONDS, then `render`.
//
// The state is a VALUE, and every frame is a transition over it. The engine hands
// `update` the current state as a read-only view (`DeepReadonly<DeepcoreState>`)
// and stores whatever `update` returns as the next state; `render` is handed
// that next state, as the same read-only view, and returns nothing. Nothing ever
// holds a writable `DeepcoreState`: `update` builds the next state from the
// current one (spread the parts that change, `map` over the arrays) rather than
// assigning into it, and a frame that returns `undefined` is refused by the
// engine. The engine's own documentation, seeded at `engine/`, defines all of
// this and the scoped APIs each function receives; read it before you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose or a control takes the
// current state and returns the next (`setFuel(state, 40)`), a reading takes the
// state and returns what it read (`snapshot(state)`), and a caller drives them
// through `engine.apply` and `engine.state`. Where its implementation lives under
// `src/` is your call; the only fixed point is that `initialize` returns it.
//
// THE CAMERA IS YOURS. The mine is far wider and far deeper than the stage, and
// this engine draws nothing and holds no camera: it hands `render` a 2D context
// covering the logical stage. Deepcore scrolls that view over the world itself,
// as its own transform on the context, and `specs/world.md` states where the
// camera sits each frame and how its lead builds and unwinds.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the mine itself. This placeholder is replaced by the build with
 * the color its stage uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Deepcore: src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<DeepcoreState, DeepcoreDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against the codes bound to it, define the
   * thirteen CUES over the produced `.wav` files, load the produced sprites,
   * animation frames, and particle systems specs/assets.md fixes, register the
   * diagnostic sources specs/instrumentation.md lists — each is handed the state
   * current at the read, so none closes over the state built here — and build the
   * complete initial state: the title screen, with every field of DeepcoreState
   * set, including the fields an expedition in progress would use, at the resting
   * values `reset` restores. Return it beside the debug surface.
   */
  initialize(_api: InitApi<DeepcoreState>): [DeepcoreState, DeepcoreDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `dt` is the real elapsed SECONDS of this frame, and `simTime` accumulates it
   * on every update whatever the screen. Read the frame's actions and the
   * pointer, run the miner's movement, drilling, fuel and hull against `dt`,
   * resolve the hazards, the economy, the Core Sample's timer and the camera's
   * lead, play cues, and mirror the engine's mute bit into the returned state's
   * `muted`. The value returned is what `render` draws and what the next `update`
   * receives; `state` itself is read-only and stays as it was.
   */
  update(
    _state: DeepReadonly<DeepcoreState>,
    _api: UpdateApi,
    _dt: number,
  ): DeepcoreState {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned.
   *
   * `api.ctx` arrives cleared and already carrying the logical transform, so draw
   * in 1280x720 coordinates and never read the canvas element's size. The status
   * bar is drawn in that space directly; the mine is drawn under the camera's own
   * transform, which this function applies and unwinds. The state arrives
   * read-only, so the type is what guarantees that rendering changes nothing.
   */
  render(_state: DeepReadonly<DeepcoreState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
