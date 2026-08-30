// Floe — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// it holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// FIRST, DECLARE AND EXPORT `FloeState`, exactly as `specs/state.md` fixes it,
// and `FloeDebugApi`, the debug and automation surface
// `specs/instrumentation.md` specifies. The stub below is written against both
// names, so this project does not compile until they exist — the type check
// failing on a freshly seeded workspace is the starting point, not a broken seed.
//
// THEN IMPLEMENT the three functions. `initialize` runs once, when the engine is
// initialized, and returns the state and the debug surface together, as the pair
// `[state, debug]`. `update` and `render` then run once each per frame — `update`
// first, with the frame's delta time in SECONDS, then `render`.
//
// FLOE RUNS ON A FIXED STEP. `update` is handed the frame's real elapsed seconds,
// and the simulation advances in whole ticks of `TICK_DT` (1/120 s), running as
// many as that elapsed time completes and carrying the remainder into the next
// frame. Every rate in `src/constants.ts` is integrated against `TICK_DT` rather
// than against the frame's own delta; `specs/overview.md` states the rule.
//
// The state is a VALUE, and every tick is a transition over it. The engine hands
// `update` the current state as a read-only view (`DeepReadonly<FloeState>`) and
// stores whatever `update` returns as the next state; `render` is handed that
// next state, as the same read-only view, and returns nothing. Nothing ever holds
// a writable `FloeState`: `update` builds the next state from the current one
// (spread the parts that change, `map` over the arrays) rather than assigning into
// it, and a frame that returns `undefined` is refused by the engine. The engine's
// own documentation, seeded at `engine/`, defines all of this and the scoped APIs
// each function receives; read it before you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose takes the current state and
// returns the next (`setLives(state, n)`), a reading takes the state and returns
// what it read (`snapshot(state)`), and a caller drives them through
// `engine.apply` and `engine.state`. Where its implementation lives under `src/`
// is your call; the only fixed point is that `initialize` returns it.
//
// THE SPRITE ART comes from the engine's asset loader, which resolves every path
// under the fixed `assets/` root relative to the page. Await every frame inside
// `initialize`, so a frame is a plain image value by the time anything draws it.
// `specs/assets.md` states which folders exist, how many frames each holds, which
// frame is drawn for which state, and how each is drawn.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

/**
 * The stage background, a CSS colour string. `src/main.ts` hands it to the engine
 * as the colour the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the strait itself. This placeholder is replaced by the build
 * with the colour its strait uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Floe: src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<FloeState, FloeDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Load every sprite frame specs/assets.md names, register every action in
   * ACTIONS against its BINDINGS, define the ten CUES, register the diagnostic
   * sources specs/instrumentation.md lists — each is handed the state current at
   * the read, so none closes over the state built here — and build the complete
   * initial state: the title screen, with every field of FloeState set, including
   * the fields play has not reached yet, which start at the resting values
   * specs/state.md gives them. Return it beside the debug surface.
   */
  initialize(_api: InitApi<FloeState>): [FloeState, FloeDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `dt` is the real elapsed SECONDS of this frame. Accumulate it, run the whole
   * TICK_DT ticks it completes in order, carry the remainder, and advance
   * `simTime` by TICK_DT on every tick whatever the screen. Read input, play
   * cues, and mirror the engine's mute bit into the returned state's `muted`. The
   * value returned is what `render` draws and what the next `update` receives;
   * `state` itself is read-only and stays as it was.
   */
  update(
    _state: DeepReadonly<FloeState>,
    _api: UpdateApi,
    _dt: number,
  ): FloeState {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned.
   *
   * `api.ctx` arrives cleared and already carrying the logical transform, so draw
   * in 1280x720 coordinates and never read the canvas element's size. The state
   * arrives read-only, so the type is what guarantees that rendering changes
   * nothing.
   */
  render(_state: DeepReadonly<FloeState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
