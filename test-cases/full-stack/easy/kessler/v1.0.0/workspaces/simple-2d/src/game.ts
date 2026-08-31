// Kessler — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// it holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// FIRST, DECLARE AND EXPORT `KesslerState`, the whole authoritative state the
// specification's rules require of the game, and `KesslerDebugApi`, the debug
// and automation surface `specs/instrumentation.md` specifies. The stub below is
// written against both names, so this project does not compile until they exist
// — the type check failing on a freshly seeded workspace is the starting point,
// not a broken seed. What `KesslerState` carries is yours to shape, subject to
// the snapshot `specs/instrumentation.md` fixes.
//
// THEN IMPLEMENT the three functions. `initialize` runs once, when the engine is
// initialized, and returns the state and the debug surface together, as the pair
// `[state, debug]`. `update` and `render` then run once each per frame — `update`
// first, with the frame's delta time in SECONDS, then `render`.
//
// KESSLER RUNS ON A FIXED TICK. `update` accumulates the seconds it is handed
// and resolves one tick for each whole TICK_DT the accumulator holds, carrying
// the remainder, and it resolves each tick in the six-step order
// `specs/field.md` fixes. The full simulation ticks on the `playing` screen
// alone, the `waveclear` screen advances only its interstitial timer, and
// `render` advances nothing. Every contact is the simulation's own polar
// crossing math over the state — nothing is delegated to the engine.
//
// The state is a VALUE, and every frame is a transition over it. The engine
// hands `update` the current state as a read-only view
// (`DeepReadonly<KesslerState>`) and stores whatever `update` returns as the
// next state; `render` is handed that next state, as the same read-only view,
// and returns nothing. Nothing ever holds a writable `KesslerState`: `update`
// builds the next state from the current one (spread the parts that change,
// `map` over the arrays) rather than assigning into it, and a frame that
// returns `undefined` is refused by the engine. The engine's own documentation,
// seeded at `engine/`, defines all of this and the scoped APIs each function
// receives; read it before you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose takes the current state
// and returns the next (`setScore(state, 500)`), a reading takes the state and
// returns what it read (`snapshot(state)`), and a caller drives them through
// `engine.apply` and `engine.state`. Where its implementation lives under
// `src/` is your call; the only fixed point is that `initialize` returns it.
//
// THE ART AND THE SOUND ARE YOURS TO PRODUCE. Kessler ships neither.
// `specs/assets.md` states which tool on the `PATH` makes each file, where it
// lands under `assets/`, and the bar it is held to; `src/constants.ts` names
// the paths. Load the sprites through the engine's asset loader, bind the CUES
// to its cue bus, and play each produced particle system through
// `@test-cabinet/particle-runtime`'s `./canvas` binding over the context
// `render` receives.

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
 * the stage match the field. This placeholder is replaced by the build with the
 * color its field uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Kessler: src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<KesslerState, KesslerDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, define the thirteen
   * CUES over the produced files, load the produced sprites and particle
   * systems, register the diagnostic sources specs/instrumentation.md lists —
   * each is handed the state current at the read, so none closes over the state
   * built here — and build the complete initial state: the title screen, with
   * every field of KesslerState set. Return it beside the debug surface.
   */
  initialize(_api: InitApi<KesslerState>): [KesslerState, KesslerDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `dt` is the real elapsed SECONDS of this frame. Read the frame's actions and
   * act on them per screen as specs/controls.md states, accumulate `dt` into the
   * tick accumulator, resolve every whole tick the accumulator holds in the
   * order specs/field.md fixes, and play cues on the tick their event resolves.
   * The value returned is what `render` draws and what the next `update`
   * receives; `state` itself is read-only and stays as it was.
   */
  update(
    _state: DeepReadonly<KesslerState>,
    _api: UpdateApi,
    _dt: number,
  ): KesslerState {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned.
   *
   * `api.ctx` arrives cleared and already carrying the logical transform, so
   * draw in 1000x1000 coordinates and never read the canvas element's size. Map
   * each polar position onto the stage with the mapping specs/overview.md fixes,
   * draw every sprite at native size centered on its object, and advance the
   * live particle players on the frame's delta. The state arrives read-only, so
   * the type is what guarantees that rendering changes nothing.
   */
  render(_state: DeepReadonly<KesslerState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
