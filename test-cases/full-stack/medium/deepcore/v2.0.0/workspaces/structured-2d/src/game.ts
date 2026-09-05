// Deepcore — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// the world holds, the debug surface that poses and reads that state, and the
// definition below.
//
// FIRST, DECLARE AND EXPORT `DeepcoreState` — a class extending the engine's
// `GameState`, carrying the whole authoritative state the specification's rules
// require of the game — and `DeepcoreDebugApi`, the debug and automation surface
// `specs/instrumentation.md` specifies. The stub below is written against both
// names, so this project does not compile until they exist — the type check
// failing on a freshly seeded workspace is the starting point, not a broken seed.
//
// THEN IMPLEMENT the game inside the engine's framework. The definition below
// registers the single level the whole game runs in: the engine opens it once, at
// `startLevel`, and the game never opens another — every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session. The instance's `initialize` runs once, before that level opens:
// register every action in ACTIONS against the codes bound to it, define the
// thirteen CUES over the produced `.wav` files, load the produced sprites,
// animation frames, and particle systems specs/assets.md fixes, and return the
// debug surface, which the engine holds and returns from `engine.debug`
// (`specs/instrumentation.md`). The level's game mode runs the screens and the
// rules: its `gameStateClass` is `DeepcoreState`, so the engine builds the state
// when the world opens, at the resting values `reset` restores; its `beginPlay`
// adds a single player possessing the prospector, whose controller is where the
// frame's actions and pointer are read, and registers the diagnostic sources
// `specs/instrumentation.md` lists through `world.diagnostics`, each a pure read
// of the live state at the call; and its `tick` accumulates `state.simTime` and
// mirrors the engine's mute bit into `state.muted`. The framework's states are
// live objects — a tick writes the fields it advances in place — and the actors,
// components, and controllers you write draw that state and drive it, holding no
// authoritative state of their own. The engine's own documentation, seeded at
// `engine/`, defines all of this and the classes below; read it before you start.
//
// THE CAMERA IS THE ENGINE'S. The mine is far wider and far deeper than the
// logical field, and this engine owns the camera that projects one into the
// other. The game positions it each frame and otherwise leaves it at a zoom of
// `1` and no rotation; `specs/world.md` states where it sits and how its lead
// builds and unwinds.

import { GameInstance, GameMode } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi } from "@clockwyrks/structured-2d";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the mine itself. This placeholder is replaced by the build with
 * the color its stage uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Deepcore: src/game.ts is not implemented yet";

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. Register the actions,
 * define the cues, load the produced assets, and return the debug surface
 * `specs/instrumentation.md` specifies.
 */
class DeepcoreInstance extends GameInstance<DeepcoreDebugApi> {
  override initialize(_api: InitApi): DeepcoreDebugApi {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the surface
 * camp, the mine, the single player, and the per-frame bookkeeping the
 * specification asks of every tick.
 */
class DeepcoreMode extends GameMode {
  override gameStateClass = DeepcoreState;
}

/**
 * The game this build's engine drives.
 *
 * Implement the instance and the mode, and split the work across new modules
 * under `src/` however you like — the mine and its generation, the miner, the
 * drill, the hazards, the economy, the actors and components that render, the
 * debug surface, and so on. Nothing else in the project needs changing for the
 * game to run: `src/main.ts` already binds this definition to the engine.
 */
export const game: GameDefinition<DeepcoreDebugApi> = {
  instance: DeepcoreInstance,
  levels: { mine: { mode: DeepcoreMode } },
  startLevel: "mine",
};
