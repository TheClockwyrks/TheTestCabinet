// Carom (Gyre) — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state it
// holds, the debug surface that poses and reads that state, and the three
// functions below.
//
// FIRST, DECLARE AND EXPORT `CaromState`, exactly as `specs/state.md` fixes it,
// and `CaromDebugApi`, the debug and automation surface `specs/instrumentation.md`
// specifies. The stub below is written against both names, so this project does
// not compile until they exist — the type check failing on a freshly seeded
// workspace is the starting point, not a broken seed.
//
// THEN IMPLEMENT the three functions. `initialize` runs once, when the engine is
// initialized, and returns the state and the debug surface together, as the pair
// `[state, debug]`. `update` and `render` then run once each per frame — `update`
// first, with the frame's delta time in SECONDS, then `render`. The state is the
// only channel between them. The engine's own documentation, seeded at `engine/`,
// defines all of this and the scoped APIs each function receives; read it before
// you start.
//
// The engine returns the surface from `engine.debug`, exactly as `initialize`
// handed it over, which is how the game is driven from code
// (`specs/instrumentation.md`). Where its implementation lives under `src/` is
// your call; the only fixed point is that `initialize` returns it.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";

/**
 * The field background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the field match the field itself. This placeholder is replaced by the build
 * with the color its field uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Carom (Gyre): src/game.ts is not implemented yet";

/**
 * The game this build's engine drives.
 *
 * Implement all three functions. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this object to the engine.
 */
export const game: Game<CaromState, CaromDebugApi> = {
  /**
   * Runs once, before any frame.
   *
   * Register every action in ACTIONS against its BINDINGS, define the four CUES,
   * register the diagnostic sources specs/instrumentation.md lists, and build
   * the complete initial state — the title screen, with every field of
   * CaromState set — and the debug surface over it. Return the two together.
   */
  initialize(_api: InitApi): [CaromState, CaromDebugApi] {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, before `render`.
   *
   * `dt` is the real elapsed SECONDS of this frame. Every rate in
   * `src/constants.ts` is per second and is multiplied by it, so the same
   * interval of game time reaches the same state however it was divided into
   * frames. Read input, advance the simulation, play cues, and mirror the
   * engine's mute bit into `state.muted`.
   */
  update(_state: CaromState, _api: UpdateApi, _dt: number): void {
    throw new Error(NOT_IMPLEMENTED);
  },

  /**
   * Runs once per frame, after `update`.
   *
   * `api.ctx` arrives cleared and already carrying the logical transform, so draw
   * in 1280x720 coordinates and never read the canvas element's size. Draw only:
   * rendering must not change `state`.
   */
  render(_state: CaromState, _api: RenderApi): void {
    throw new Error(NOT_IMPLEMENTED);
  },
};
