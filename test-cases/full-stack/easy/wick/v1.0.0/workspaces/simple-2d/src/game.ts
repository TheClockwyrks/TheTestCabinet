// Wick — the game. This is the file the build implements.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// it holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// First, declare and export `WickState`, exactly as `specs/state.md` fixes it,
// and `WickDebugApi`, the debug and automation surface
// `specs/instrumentation.md` specifies. The stub below is written against both
// names, so this project does not compile until they exist.
//
// Then implement the three functions. `initialize` runs once, when the engine is
// initialized, and returns the state and the debug surface together, as the pair
// `[state, debug]`. `update` and `render` then run once each per frame, `update`
// first, with the frame's delta time in seconds, then `render`.
//
// The state is a value, and every frame is a transition over it. The engine
// hands `update` the current state as a read-only view
// (`DeepReadonly<WickState>`) and stores whatever `update` returns as the next
// state; `render` is handed that next state, as the same read-only view, and
// returns nothing. Nothing ever holds a writable `WickState`: `update` builds
// the next state from the current one (spread the parts that change, `map` over
// the arrays) rather than assigning into it, and a frame that returns
// `undefined` is refused by the engine. The engine's own documentation, seeded
// at `engine/`, defines all of this and the scoped APIs each function receives.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose takes the current state
// and returns the next (`start(state)`, `spawnEnemy(state, type, x, y)`), a
// reading takes the state and returns what it read (`snapshot(state)`), and a
// caller drives them through `engine.apply` and `engine.state`. Where its
// implementation lives under `src/` is your call; the only fixed point is that
// `initialize` returns it.
//
// A run advances on the fixed tick. `update` accumulates the frame's delta time
// and consumes whole TICK_DT-second ticks from it while `screen` is `playing`,
// each tick the full simulation `specs/world.md` orders; nothing ticks on the
// overlays or on any other screen. The camera stays on the lamplighter, so
// `render` draws the world through the view centered on the player, in the
// fixed 1280x720 logical stage.
//
// The sprites and sounds are produced, not supplied. `specs/assets.md` states
// what you produce with the asset tools and commit under `public/assets/`;
// `initialize` loads each image with `api.assets.loadImage` and binds each cue
// to its file with `api.audio.load`, awaited, so every asset is decoded before
// the first frame.

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
 * the stage match the night. This placeholder is replaced by the build with the
 * color its night uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Wick: src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<WickState, WickDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, load the produced
   * sprites and bind each of the CUES to its produced file, register the
   * diagnostic sources specs/instrumentation.md lists (each is handed the
   * state current at the read, so none closes over the state built here), and
   * build the complete initial state: the title screen over the idle run, with
   * every field of WickState set exactly as specs/state.md states. Return it
   * beside the debug surface.
   */
  initialize(_api: InitApi<WickState>): [WickState, WickDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `dt` is the real elapsed seconds of this frame, and `simTime` accumulates
   * it on every update whatever the screen. Read the frame's actions, drive
   * the menus and the overlays, and, while `screen` is `playing`, add `dt` to
   * the accumulator and consume whole ticks of TICK_DT from it, each tick the
   * full simulation in the order specs/world.md fixes. Play cues on their
   * events, reconcile the two looping cues against the state, and mirror the
   * engine's mute bit into the returned state's `muted`. The value returned is
   * what `render` draws and what the next `update` receives; `state` itself is
   * read-only and stays as it was.
   */
  update(
    _state: DeepReadonly<WickState>,
    _api: UpdateApi,
    _dt: number,
  ): WickState {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned.
   *
   * `api.ctx` arrives cleared and already carrying the logical transform, so
   * draw in 1280x720 coordinates and never read the canvas element's size. The
   * camera is centered on the lamplighter: a world point draws at its position
   * minus the player's plus the stage center, with the produced sprites
   * sampled nearest-neighbor, and the HUD and the screens over the world. The
   * state arrives read-only, so the type is what guarantees that rendering
   * changes nothing.
   */
  render(_state: DeepReadonly<WickState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
