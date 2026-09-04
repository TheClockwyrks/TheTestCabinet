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
// (`DeepReadonly<GantryState>`, which the engine re-exports) and stores whatever
// `update` returns as the next state; `render` is handed that next state, as the
// same read-only view, and returns nothing. Nothing ever holds a writable
// `GantryState`: `update` builds the next state from the current one rather than
// assigning into it. The engine's own documentation, seeded at `engine/`,
// defines all of this and the scoped APIs each function receives; read it before
// you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Because no one holds a writable state, the
// surface is written in the shape of `update`: a pose takes the current state
// and returns the next (`setTool(state, "cable")`), a reading takes the state
// and returns what it read (`snapshot(state)`), and a caller drives them through
// `engine.apply` and `engine.state`.
//
// A RUN ADVANCES ON THE FIXED TICK. `update` accumulates the frame's delta time
// and consumes whole 1/TICK_HZ-second ticks from it while a run is in progress,
// each tick the full pipeline `specs/program.md` fixes; nothing ticks on the
// other screens.
//
// THE YARD IS DRAWN THROUGH THE ENGINE'S SCENE. `render` is handed the retained
// scene, the camera the frame is drawn through, and the 2D screen layer already
// carrying the logical stage's transform: the ground, the lights, the lattice
// and envelope aids, the members colored by utilization, the hoist cable, the
// pads, and the produced models are three objects in that scene, and the
// readouts go over the picture on the screen layer. What one frame adds to the
// scene is still there on the next. `three` is the project's own dependency and
// the engine takes it as a peer, so both share the one copy.
//
// THE POINTER comes from the engine, already in logical stage units, with the
// frame's ordered samples and its press and release edges; `view()` casts a
// point on the stage into a ray through the camera the player is looking
// through, and projects a world point back onto the stage. `specs/controls.md`
// states what Gantry picks, in what priority, and within what screen distance.
//
// THE PRODUCED ASSETS ARE YOURS TOO. `specs/assets.md` fixes which tool on this
// container's `PATH` produces each model and sound, and every produced file is
// committed under ASSET_ROOT, which the engine's asset loader resolves every
// path against. That loader is also the decoder: `loadModel` hands a committed
// `.glb` back as a model whose meshes carry the file's own per-vertex colors,
// and `cloneModel` places a copy of one in the scene. A produced model declares
// no material of its own, so those meshes arrive on the loader's default one,
// which is yours to replace.

import type {
  DeepReadonly,
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-3d";

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
 * Implement all three functions, and split the work across new modules under
 * `src/` however you like. Nothing else in the project needs changing for the
 * game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<GantryState, GantryDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, back each of the
   * eleven CUES with the file specs/assets.md produces for it, load the
   * produced models, register the diagnostic sources
   * specs/instrumentation.md lists — each is handed the state current at the
   * read, so none closes over the state built here — and build the complete
   * initial state: the title screen, with every field of GantryState set, the
   * idle run included, exactly as specs/state.md states. Return it beside the
   * debug surface.
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
   * Populate the scene with the yard, pose the camera the player orbits, and
   * draw the screen's readouts over the picture in the fixed 1280x720 logical
   * stage. The state arrives read-only, so the type is what guarantees that
   * rendering changes nothing.
   */
  render(_state: DeepReadonly<GantryState>, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
