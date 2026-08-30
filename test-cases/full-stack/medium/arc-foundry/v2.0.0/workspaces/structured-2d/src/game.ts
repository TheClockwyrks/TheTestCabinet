// Arc Foundry — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// the world holds, the debug surface that poses and reads that state, and the
// definition below.
//
// FIRST, DECLARE AND EXPORT `FoundryState`, the class the whole of the game's
// authoritative state is held in — a class extending the engine's `GameState` —
// and `FoundryDebugApi`, the debug and automation surface
// `specs/instrumentation.md` specifies. The stub below is written against both
// names, so this project does not compile until they exist — the type check
// failing on a freshly seeded workspace is the starting point, not a broken
// seed. The shape of `FoundryState` is yours.
//
// THEN IMPLEMENT the game inside the engine's framework. The definition below
// registers the single level the whole game runs in: the engine opens it once,
// at `startLevel`, and the game never opens another — every screen is a value of
// the state's screen field. The instance's `initialize` runs once, before that
// level opens: register every action in ACTIONS against its BINDINGS, define the
// twelve CUES against the files specs/assets.md produces for them, load the
// produced sprites, cycles, and particle systems through the engine's asset
// loader, and return the debug surface, which the engine holds and returns from
// `engine.debug` (`specs/instrumentation.md`). The level's game mode runs the
// screens and the rules: its `gameStateClass` is `FoundryState`, so the engine
// builds that state when the world opens, with every field at its title-screen
// initializer; its `beginPlay` adds a single player possessing nothing, whose
// controller is where the frame's actions and pointer are read, and registers
// the diagnostic sources `specs/instrumentation.md` lists through
// `world.diagnostics`, each a pure read of the live state at the call; and its
// `tick` advances the simulation clock by `dt * speed` on the playing screen
// while unpaused and by nothing otherwise (specs/controls.md) and mirrors the
// engine's mute bit into the state. Leave the camera at rest, so world units and
// the stage's logical units coincide. The framework's states are live objects — a
// tick writes the fields it advances in place — and the actors, components, and
// controllers you write draw that state and drive it, holding no authoritative
// state of their own. The engine's own documentation, seeded at `engine/`,
// defines all of this and the classes below; read it before you start.
//
// The POINTER comes from the engine as well. The yard is built by pressing on the
// stage, and the player controller reads the pointer from its input reader
// already in logical stage units, as the frame's ordered samples carrying the
// press and release edges — the engine's input documentation, seeded at
// `engine/`, defines the API, and `specs/controls.md` states what Arc Foundry
// does with them.
//
// THE PRODUCED ASSETS ARE YOURS TOO. `specs/assets.md` fixes which of the six
// on-PATH tools produces each sprite, animation cycle, particle system, and
// sound, and the exact path each lands at under `assets/`. The engine's asset
// loader resolves every path under that root; the particle runtime
// `@test-cabinet/particle-runtime` is already a dependency, and because the
// declarative pipeline draws no particles, a produced `system.json` is played
// through its canvas binding from a draw component handed the raw context.

import { GameInstance, GameMode } from "@test-cabinet/structured-2d";
import type { GameDefinition, InitApi } from "@test-cabinet/structured-2d";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the yard itself. This placeholder is replaced by the build
 * with the color its yard uses.
 */
export const BACKGROUND = "#05080c";

const NOT_IMPLEMENTED = "Arc Foundry: src/game.ts is not implemented yet";

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. Register the
 * actions, define the cues, load the produced assets, and return the debug
 * surface `specs/instrumentation.md` specifies.
 */
class FoundryInstance extends GameInstance<FoundryDebugApi> {
  override initialize(_api: InitApi): FoundryDebugApi {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the build
 * phase and the wave, the single player, and the per-frame bookkeeping the
 * specification asks of every tick.
 */
class FoundryMode extends GameMode {
  override gameStateClass = FoundryState;
}

/**
 * The game this build's engine drives.
 *
 * Implement the instance and the mode, and split the work across new modules
 * under `src/` however you like — the yard and its maps, the router, the press
 * and its rolls, the components and the combines, the Load and its waves, the
 * economy, the panel and the overlays, the actors and components that render,
 * the debug surface, and so on. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this definition to the engine.
 */
export const game: GameDefinition<FoundryDebugApi> = {
  instance: FoundryInstance,
  levels: { yard: { mode: FoundryMode } },
  startLevel: "yard",
};
