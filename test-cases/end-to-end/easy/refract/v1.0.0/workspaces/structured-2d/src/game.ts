// Refract — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// the world holds, the debug surface that poses and reads that state, and the
// definition below.
//
// FIRST, DECLARE AND EXPORT `RefractState`, exactly as `specs/state.md` fixes it
// — a class extending the engine's `GameState` — and `RefractDebugApi`, the
// debug and automation surface `specs/instrumentation.md` specifies. The stub
// below is written against both names, so this project does not compile until
// they exist — the type check failing on a freshly seeded workspace is the
// starting point, not a broken seed.
//
// THEN IMPLEMENT the game inside the engine's framework. The definition below
// registers the single level the whole game runs in: the engine opens it once,
// at `startLevel`, and the game never opens another — every screen is a value of
// the state's `screen` field. The instance's `initialize` runs once, before that
// level opens: register every action in ACTIONS against its BINDINGS, define the
// five CUES, and return the debug surface, which the engine holds and returns
// from `engine.debug` (`specs/instrumentation.md`). The level's game mode runs
// the screens and the rules: its `gameStateClass` is `RefractState`, so the
// engine builds the state `specs/state.md` declares when the world opens, with
// every field at its title-screen initializer; its `beginPlay` adds a single
// player possessing nothing, whose controller is where the frame's actions and
// pointer are read, and registers the diagnostic sources
// `specs/instrumentation.md` lists through `world.diagnostics`, each a pure read
// of the live state at the call; and its `tick` accumulates `state.simTime` and
// mirrors the engine's mute bit into `state.muted`. The framework's states are live objects — a tick writes
// the fields it advances in place — and the actors, components, and controllers
// you write draw that state and drive it, holding no authoritative state of
// their own. The engine's own documentation, seeded at `engine/`, defines all of
// this and the classes below; read it before you start.
//
// The POINTER comes from the engine as well. A beam is drawn by pressing on the
// stage and dragging, and the player controller reads it from its input reader
// already in logical stage units, as the frame's ordered samples carrying the
// press and release edges — the engine's input documentation, seeded at
// `engine/`, defines the API, and `specs/controls.md` states what Refract does
// with them.

import { GameInstance, GameMode } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi } from "@clockwyrks/structured-2d";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the bench itself. This placeholder is replaced by the build
 * with the color its bench uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Refract: src/game.ts is not implemented yet";

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. Register the
 * actions, define the cues, and return the debug surface
 * `specs/instrumentation.md` specifies.
 */
class RefractInstance extends GameInstance<RefractDebugApi> {
  override initialize(_api: InitApi): RefractDebugApi {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the single
 * player, and the per-frame bookkeeping the specification asks of every tick.
 */
class RefractMode extends GameMode {
  override gameStateClass = RefractState;
}

/**
 * The game this build's engine drives.
 *
 * Implement the instance and the mode, and split the work across new modules
 * under `src/` however you like — the board, the ruleset, the tracing, the
 * board generator, the actors and components that render, the debug surface,
 * and so on. Nothing else in the project needs changing for the game to run:
 * `src/main.ts` already binds this definition to the engine.
 */
export const game: GameDefinition<RefractDebugApi> = {
  instance: RefractInstance,
  levels: { bench: { mode: RefractMode } },
  startLevel: "bench",
};
