// Arc Foundry — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// it holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// FIRST, DECLARE AND EXPORT `FoundryState`, the type the whole of the game's
// state is held in, and `FoundryDebugApi`, the debug and automation surface
// `specs/instrumentation.md` specifies. The stub below is written against both
// names, so this project does not compile until they exist — the type check
// failing on a freshly seeded workspace is the starting point, not a broken
// seed. The shape of `FoundryState` is yours; every field it carries is
// `readonly`, because the engine hands it out read-only and replaces it whole.
//
// THEN IMPLEMENT the three functions. `initialize` runs once, when the engine is
// initialized, and returns the state and the debug surface together, as the pair
// `[state, debug]`. `update` and `render` then run once each per frame — `update`
// first, with the frame's delta time in SECONDS, then `render`.
//
// The state is a VALUE, and every frame is a transition over it. The engine hands
// `update` the current state as a read-only view (`DeepReadonly<FoundryState>`)
// and stores whatever `update` returns as the next state; `render` is handed that
// next state, as the same read-only view, and returns nothing. Nothing ever holds
// a writable `FoundryState`: `update` builds the next state from the current one
// (spread the parts that change, `map` over the arrays) rather than assigning into
// it, and a frame that returns `undefined` is refused by the engine. The engine's
// own documentation, seeded at `engine/`, defines all of this and the scoped APIs
// each function receives; read it before you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose takes the current state and
// returns the next (`setCharge(state, amount)`), a reading takes the state and
// returns what it read (`snapshot(state)`), and a caller drives them through
// `engine.apply` and `engine.state`. Where its implementation lives under `src/`
// is your call; the only fixed point is that `initialize` returns it.
//
// The POINTER comes from the engine as well. The yard is built by pressing on the
// stage, and the engine hands `update` the pointer's position already in logical
// stage units along with its press and release edges — the engine's input
// documentation, seeded at `engine/`, defines the API, and `specs/controls.md`
// states what Arc Foundry does with them.
//
// THE PRODUCED ASSETS ARE YOURS TOO. `specs/assets.md` fixes which of the six
// on-PATH tools produces each sprite, animation cycle, particle system, and
// sound, and the exact path each lands at under `assets/`. The engine's asset
// loader resolves every path under that root; the particle runtime
// `@test-cabinet/particle-runtime` is already a dependency and plays a produced
// `system.json` through its canvas binding.

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
 * the stage match the yard itself. This placeholder is replaced by the build
 * with the color its yard uses.
 */
export const BACKGROUND = "#05080c";

const NOT_IMPLEMENTED = "Arc Foundry: src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<FoundryState, FoundryDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, define the twelve
   * CUES against the files specs/assets.md produces for them, load the produced
   * sprites, cycles, and particle systems through the engine's asset loader,
   * register the diagnostic sources specs/instrumentation.md lists — each is
   * handed the state current at the read, so none closes over the state built
   * here — and build the complete initial state: the title screen, with every
   * field of FoundryState set, including the fields no run has filled in yet.
   * Return it beside the debug surface.
   */
  initialize(_api: InitApi<FoundryState>): [FoundryState, FoundryDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `dt` is the real elapsed SECONDS of this frame. The simulation clock advances
   * by `dt * speed` on the playing screen while unpaused and by nothing
   * otherwise (specs/controls.md), and every rate and duration this game states
   * is integrated against that advance. Read the frame's actions and the
   * pointer, run the build controls and the wave, walk the Load along the routes
   * specs/pathing.md fixes, fire the structures, fly the projectiles, tick the
   * status effects and the economy, play cues, and mirror the engine's mute bit
   * into the returned state's `muted`. The value returned is what `render` draws
   * and what the next `update` receives; `state` itself is read-only and stays as
   * it was.
   */
  update(
    _state: DeepReadonly<FoundryState>,
    _api: UpdateApi,
    _dt: number,
  ): FoundryState {
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
  render(_state: DeepReadonly<FoundryState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
