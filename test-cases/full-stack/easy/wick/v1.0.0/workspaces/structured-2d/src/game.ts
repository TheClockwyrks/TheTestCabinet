// Wick — the game. This is the file the build implements.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are supplied
// with the project and stay as they are. What is missing is the game: the state
// the world holds, the debug surface that poses and reads that state, and the
// definition below.
//
// First, declare and export `WickState`, a class extending the engine's
// `GameState`, exactly as `specs/state.md` fixes it, and `WickDebugApi`, the
// debug and automation surface `specs/instrumentation.md` specifies. The stub
// below is written against both names, so this project does not compile until
// they exist.
//
// Then implement the game inside the engine's framework. Wick runs in one level
// for the whole session: the definition below registers the single level named
// by LEVEL_NAME, the engine opens it once at `startLevel`, and the game never
// opens another. Every screen, the title, the how-to, the night, the two
// overlays, the pause, and the two endings, is a value of the state's `screen`
// field, so the world and its game state live for the whole session and
// starting a run is not a level transition.
//
// The instance's `initialize` runs once, before that level opens: register
// every action in ACTIONS against its BINDINGS, bind each of the CUES to its
// produced file, load the produced sprites `src/constants.ts` names, and return
// the debug surface, which the engine holds and returns from `engine.debug`
// (`specs/instrumentation.md`). The level's game mode runs the screens and the
// rules: its `gameStateClass` is `WickState`, so the engine builds the state
// when the world opens, with every field at its title-screen value and every
// driver switch on; its `beginPlay` adds a single player possessing the
// lamplighter, whose controller is the one place the frame's actions are read,
// and registers the diagnostic sources `specs/instrumentation.md` lists through
// `world.diagnostics`, each a pure read of the live state at the call; and its
// `tick` accumulates the frame's seconds while `screen` is `playing`, resolves
// each whole TICK_DT of them in the order `specs/world.md` fixes, the driver
// switches gating the phases they name, and carries the remainder, discarding
// it on a tick that leaves `playing`. Every contact is the simulation's own
// circle and rectangle math over that state; no collider component and no
// engine collision event decides one. Each actor carries its tag from TAGS,
// the framework's states are live objects, a tick writing the fields it
// advances in place, and the actors, components, and controllers you write
// draw that state and drive it, holding nothing authoritative of their own.
//
// The lamplighter actor carries a `CameraComponent` and the camera follows it
// at zoom 1, so a world point draws exactly where the camera formula of
// `specs/world.md` puts it; the facing mirror lives on the lamplighter's own
// sprite component rather than on the followed actor's transform. The HUD, the
// menus, and the overlays are ordinary components on an actor the mode keeps at
// the camera target's position, each component's `offset` in stage units from
// the stage center, so they draw at fixed logical positions and keep their
// place in the layer order. The engine's own documentation, seeded at
// `engine/`, defines all of this and the classes below; read it before you
// start.
//
// The debug surface's operations act on the live world at the moment they are
// called: a pose takes only the parameters `specs/instrumentation.md` names
// for it, sets one thing through the same systems play uses, sounds nothing,
// and returns nothing; a reading returns plain data built at the call. Where
// its implementation lives under `src/` is your call; the only fixed point is
// that `initialize` returns it.
//
// The sprites and sounds are produced, not supplied. `specs/assets.md` states
// what you produce with the asset tools and commit under `assets/`, and
// `src/constants.ts` names the paths. Load each image through the engine's
// asset loader and bind each cue to its file with `api.audio.load`, awaited in
// `initialize`, so every asset is decoded before the first frame.

import { GameInstance, GameMode } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi } from "@clockwyrks/structured-2d";
import { LEVEL_NAME } from "./constants";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the engine
 * as the color the canvas is cleared to each frame, so the letterbox bars around
 * the stage match the night. This placeholder is replaced by the build with the
 * color its night uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Wick: src/game.ts is not implemented yet";

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. Register the
 * actions, bind the cues, load the produced assets, and return the debug
 * surface `specs/instrumentation.md` specifies.
 */
class WickInstance extends GameInstance<WickDebugApi> {
  override initialize(_api: InitApi): WickDebugApi {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the fixed
 * tick and everything it resolves, the single player, the diagnostic sources,
 * and the per-frame bookkeeping the specification asks of every frame.
 */
class WickMode extends GameMode {
  override gameStateClass = WickState;
}

/**
 * The game this build's engine drives.
 *
 * Implement the instance and the mode, and split the work across new modules
 * under `src/` however you like. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this definition to the engine.
 */
export const game: GameDefinition<WickDebugApi> = {
  instance: WickInstance,
  levels: { [LEVEL_NAME]: { mode: WickMode } },
  startLevel: LEVEL_NAME,
};
