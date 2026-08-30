// Meltdown — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// it holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// FIRST, DECLARE AND EXPORT `MeltdownState`, exactly as `specs/state.md` fixes
// it, and `MeltdownDebugApi`, the debug and automation surface
// `specs/instrumentation.md` specifies. The stub below is written against both
// names, so this project does not compile until they exist — the type check
// failing on a freshly seeded workspace is the starting point, not a broken
// seed.
//
// THEN IMPLEMENT the three functions. `initialize` runs once, when the engine is
// initialized, and returns the state and the debug surface together, as the pair
// `[state, debug]`. `update` and `render` then run once each per frame — `update`
// first, with the frame's delta time in SECONDS, then `render`.
//
// The state is a VALUE, and every frame is a transition over it. The engine hands
// `update` the current state as a read-only view (`DeepReadonly<MeltdownState>`)
// and stores whatever `update` returns as the next state; `render` is handed
// that next state, as the same read-only view, and returns nothing. Nothing ever
// holds a writable `MeltdownState`: `update` builds the next state from the
// current one (spread the parts that change, `map` over the arrays) rather than
// assigning into it, and a frame that returns `undefined` is refused by the
// engine. The engine's own documentation, seeded at `engine/`, defines all of
// this and the scoped APIs each function receives; read it before you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose takes the current state and
// returns the next (`setTowerHeat(state, id, heat)`), a reading takes the state
// and returns what it read (`snapshot(state)`), and a caller drives them through
// `engine.apply` and `engine.state`. Where its implementation lives under `src/`
// is your call; the only fixed point is that `initialize` returns it.
//
// THE POINTER comes from the engine as well. A tower is armed from the shop,
// carried across the floor as a preview and placed with a press, and the engine
// hands `update` the pointer's position already in logical stage units along
// with its press and release edges — the engine's input documentation, seeded at
// `engine/`, defines the API, and `specs/controls.md` states what Meltdown does
// with them.
//
// THE HEAT MODEL RESOLVES IN TWO PHASES, and `specs/heat.md` states the rule:
// every flow a frame resolves is computed from the heats the frame OPENED with,
// and only when every tower's change is known are the new heats written. The
// pass belongs at the end of `update`, once movement and firing have produced the
// frame's shot counts.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage match the reactor itself. This placeholder is replaced
 * by the build with the color its reactor uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Meltdown: src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<MeltdownState, MeltdownDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, define the ten CUES,
   * register the diagnostic sources specs/instrumentation.md lists — each is
   * handed the state current at the read, so none closes over the state built
   * here — and build the complete initial state: the title screen, with every
   * field of MeltdownState set, including the fields the player's chosen mode
   * will not use, which start at the resting values specs/state.md gives them.
   * Return it beside the debug surface.
   */
  initialize(_api: InitApi<MeltdownState>): [MeltdownState, MeltdownDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `dt` is the real elapsed SECONDS of this frame. Multiply it by the game
   * speed to get the game time this frame advances by, and accumulate that into
   * `simTime`. Read the frame's actions and the pointer position and edges, run
   * the wave spawner, the surge's movement along its routes, each emitter's fire
   * clock and its shots, and then the two-phase heat pass specs/heat.md fixes.
   * Play cues, and mirror the engine's mute bit into the returned state's
   * `muted`. The value returned is what `render` draws and what the next
   * `update` receives; `state` itself is read-only and stays as it was.
   */
  update(
    _state: DeepReadonly<MeltdownState>,
    _api: UpdateApi,
    _dt: number,
  ): MeltdownState {
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
  render(_state: DeepReadonly<MeltdownState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
