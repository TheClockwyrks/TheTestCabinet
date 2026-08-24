// Gantry — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// it holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// FIRST, DECLARE AND EXPORT `GantryState`, exactly as `specs/state.md` fixes it,
// and `GantryDebugApi`, the debug and automation surface
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
// The state is a VALUE, and every frame is a transition over it. The engine
// hands `update` the current state as a read-only view
// (`DeepReadonly<GantryState>`) and stores whatever `update` returns as the next
// state; `render` is handed that next state, as the same read-only view, and
// returns nothing. Nothing ever holds a writable `GantryState`: `update` builds
// the next state from the current one rather than assigning into it. The
// engine's own documentation, seeded at `engine/`, defines all of this and the
// scoped APIs each function receives; read it before you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose takes the current state
// and returns the next (`setStructure(state, doc)`), a reading takes the state
// and returns what it read (`snapshot(state)`), and a caller drives them through
// `engine.apply` and `engine.state`.
//
// A RUN ADVANCES ON THE FIXED TICK. `update` accumulates the frame's delta time
// and consumes whole 1/TICK_HZ-second ticks from it while a run is in progress,
// each tick the full pipeline `specs/program.md` fixes; nothing ticks on the
// other screens. Rendering the 3D yard is the game's own, on the installed
// `three`, inside `render`.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage match the yard's sky. This placeholder is replaced by
 * the build with the color its yard uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Gantry: src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<GantryState, GantryDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, define the CUES,
   * register the diagnostic sources specs/instrumentation.md lists — each is
   * handed the state current at the read, so none closes over the state built
   * here — and build the complete initial state: the title screen, with every
   * field of GantryState set, the idle run included, exactly as specs/state.md
   * states. Return it beside the debug surface.
   */
  initialize(_api: InitApi<GantryState>): [GantryState, GantryDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * `dt` is the real elapsed SECONDS of this frame, and `simTime` accumulates
   * it on every update whatever the screen. Read the frame's actions and the
   * pointer, move the camera and the menus against `dt`, and, while a run is in
   * progress, consume whole simulation ticks from the accumulated time at the
   * current watch speed, each tick the pipeline specs/program.md fixes. Play
   * cues on their events and mirror the engine's mute bit into the returned
   * state's `muted`.
   */
  update(
    _state: DeepReadonly<GantryState>,
    _api: UpdateApi,
    _dt: number,
  ): GantryState {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned.
   *
   * Draw the 3D yard through the orbit camera and the screen's readouts over
   * it, in the fixed 1280x720 logical stage. The state arrives read-only, so
   * the type is what guarantees that rendering changes nothing.
   */
  render(_state: DeepReadonly<GantryState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
