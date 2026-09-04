// Kessler — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// the world holds, the debug surface that poses and reads that state, and the
// definition below.
//
// FIRST, DECLARE AND EXPORT `KesslerState` — a class extending the engine's
// `GameState`, carrying the whole authoritative state the specification's rules
// require of the game — and `KesslerDebugApi`, the debug and automation surface
// `specs/instrumentation.md` specifies. The stub below is written against both
// names, so this project does not compile until they exist — the type check
// failing on a freshly seeded workspace is the starting point, not a broken
// seed.
//
// THEN IMPLEMENT the game inside the engine's framework. KESSLER RUNS IN ONE
// LEVEL FOR THE WHOLE SESSION: the definition below registers the single level
// named by LEVEL_NAME, the engine opens it once at `startLevel`, and the game
// never opens another. Every screen — the title, the how-to, the live field,
// the wave-clear interstitial, the pause, and the game over — is a value of the
// state's screen field, so the world and its game state live for the whole
// session and starting a session is not a level transition.
//
// The instance's `initialize` runs once, before that level opens: register
// every action in ACTIONS against its BINDINGS, define the thirteen CUES over
// the produced files, load the produced sprites and particle systems
// specs/assets.md fixes, and return the debug surface, which the engine holds
// and returns from `engine.debug` (`specs/instrumentation.md`). The level's
// game mode runs the screens and the rules: its `gameStateClass` is
// `KesslerState`, so the engine builds the state when the world opens, with
// every field at its title-screen value; its `beginPlay` adds a single player
// possessing the deflector, whose controller is where the frame's actions are
// read, and registers the diagnostic sources `specs/instrumentation.md` lists
// through `world.diagnostics`, each a pure read of the live state at the call;
// and its `tick` accumulates the frame's seconds, resolves each whole TICK_DT
// of them in the six-step order `specs/field.md` fixes, and carries the
// remainder. Every contact is the simulation's own polar crossing math over
// that state — no collider components and no engine collision events decide
// one. Each actor carries its tag from TAGS, the framework's states are live
// objects — a tick writes the fields it advances in place — and the actors,
// components, and controllers you write draw that state and drive it, holding
// nothing authoritative of their own. Leave the camera at rest, so world units
// and the stage's logical units coincide. The engine's own documentation,
// seeded at `engine/`, defines all of this and the classes below; read it
// before you start.
//
// THE ART AND THE SOUND ARE YOURS TO PRODUCE. Kessler ships neither.
// `specs/assets.md` states which tool on the `PATH` makes each file, where it
// lands under `assets/`, and the bar it is held to; `src/constants.ts` names
// the paths. Play each produced particle system through
// `@test-cabinet/particle-runtime`'s `./canvas` binding, from a draw component
// that puts its output in the layer order like any other picture.

import { GameInstance, GameMode } from "@test-cabinet/structured-2d";
import type { GameDefinition, InitApi } from "@test-cabinet/structured-2d";
import { LEVEL_NAME } from "./constants";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the field. This placeholder is replaced by the build with the
 * color its field uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Kessler: src/game.ts is not implemented yet";

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. Register the
 * actions, define the cues, load the produced assets, and return the debug
 * surface `specs/instrumentation.md` specifies.
 */
class KesslerInstance extends GameInstance<KesslerDebugApi> {
  override initialize(_api: InitApi): KesslerDebugApi {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the fixed
 * tick and everything it resolves, the single player, and the per-frame
 * bookkeeping the specification asks of every tick.
 */
class KesslerMode extends GameMode {
  override gameStateClass = KesslerState;
}

/**
 * The game this build's engine drives.
 *
 * Implement the instance and the mode, and split the work across new modules
 * under `src/` however you like — the tick and its six steps, the polar
 * contacts, the deflector and its bounce, the rings and their orbits, the pod
 * draw and the effects, the actors and components that render, the debug
 * surface, and so on. Nothing else in the project needs changing for the game
 * to run: `src/main.ts` already binds this definition to the engine.
 */
export const game: GameDefinition<KesslerDebugApi> = {
  instance: KesslerInstance,
  levels: { [LEVEL_NAME]: { mode: KesslerMode } },
  startLevel: LEVEL_NAME,
};
