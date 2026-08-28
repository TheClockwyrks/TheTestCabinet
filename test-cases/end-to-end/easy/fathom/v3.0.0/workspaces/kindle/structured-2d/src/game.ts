// Fathom — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// the world holds, the debug surface that poses and reads that state, and the
// definition below.
//
// FIRST, DECLARE AND EXPORT `FathomState`, exactly as `specs/state.md` fixes it
// — a class extending the engine's `GameState` — and `FathomDebugApi`, the debug
// and automation surface `specs/instrumentation.md` specifies. The stub below is
// written against both names, so this project does not compile until they exist
// — the type check failing on a freshly seeded workspace is the starting point,
// not a broken seed.
//
// THEN IMPLEMENT the game inside the engine's framework. FATHOM RUNS IN ONE
// WORLD FOR THE WHOLE SESSION: the definition below registers a single level,
// the engine opens it once at `startLevel`, and the game never opens another.
// Every screen — the title, the how-to, the countdown, live play, the pause, the
// cleared interstitial and the game over — is a value of the state's `screen`
// field, so the world and its game state live for the whole session and a dive
// is not a level transition.
//
// The instance's `initialize` runs once, before that level opens: register every
// action in ACTIONS against its BINDINGS, define the seven CUES, load the art
// under `assets/` through the engine's asset loader, and return the debug
// surface, which the engine holds and returns from `engine.debug`. The level's
// game mode runs the screens and the rules: its `gameStateClass` is
// `FathomState`, so the engine builds the state `specs/state.md` declares when
// the world opens, with every field at its title-screen value; its `beginPlay`
// adds a single player possessing nothing, whose controller is where the frame's
// actions are read, and registers the diagnostic sources
// `specs/instrumentation.md` lists through `world.diagnostics`; and its `tick`
// accumulates `state.simTime` and mirrors the engine's mute bit into
// `state.muted`. Leave the camera at rest, so world units and the stage's
// logical units coincide. The framework's states are live objects — a tick
// writes the fields it advances in place — and the actors, components, and
// controllers you write draw that state and drive it, holding nothing
// authoritative of their own. The engine's own documentation, seeded at
// `engine/`, defines all of this and the classes below; read it before you
// start.

import { GameInstance, GameMode } from "@test-cabinet/structured-2d";
import type { GameDefinition, InitApi } from "@test-cabinet/structured-2d";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the water itself. This placeholder is replaced by the build
 * with the color its trench uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Fathom: src/game.ts is not implemented yet";

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. Register the
 * actions, define the cues, load the art, and return the debug surface
 * `specs/instrumentation.md` specifies.
 */
class FathomInstance extends GameInstance<FathomDebugApi> {
  override initialize(_api: InitApi): FathomDebugApi {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the maze and
 * the creatures in it, the single player, and the per-frame bookkeeping the
 * specification asks of every tick.
 */
class FathomMode extends GameMode {
  override gameStateClass = FathomState;
}

/**
 * The game this build's engine drives.
 *
 * Implement the instance and the mode, and split the work across new modules
 * under `src/` however you like — the maze and its generator, the fog of war and
 * the light, the sonar and the ink, the three predators, the actors and
 * components that render, the debug surface, and so on. Nothing else in the
 * project needs changing for the game to run: `src/main.ts` already binds this
 * definition to the engine.
 */
export const game: GameDefinition<FathomDebugApi> = {
  instance: FathomInstance,
  levels: { trench: { mode: FathomMode } },
  startLevel: "trench",
};
