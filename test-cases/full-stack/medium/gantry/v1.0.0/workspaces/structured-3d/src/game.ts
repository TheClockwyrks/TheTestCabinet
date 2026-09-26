// Gantry — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are
// supplied with the project and stay as they are. What is missing is the game:
// the state the world holds, the debug surface that poses and reads that state,
// and the definition below.
//
// FIRST, DECLARE AND EXPORT `GantryState`, the class the whole of the game's
// authoritative state is held in — a class extending the engine's `GameState`,
// carrying every field `specs/state.md` fixes — and `GantryDebugApi`, the debug
// and automation surface `specs/instrumentation.md` specifies. The stub below
// is written against both names, so this project does not compile until they
// exist — the type check failing on a freshly seeded workspace is the starting
// point, not a broken seed.
//
// THEN IMPLEMENT the game inside the engine's framework. The definition below
// registers the single level the whole game runs in: the engine opens it once,
// at `startLevel`, and the game never opens another — every screen is a value
// of the state's `screen` field, so the world, its mode, and its state live for
// the whole session. The instance's `initialize` runs once, before that level
// opens: register every action in ACTIONS against its BINDINGS, back each of
// the eleven CUES with the file `specs/assets.md` produces for it through
// `api.audio.load`, load the produced voxel models through the engine's asset
// loader, and return the debug surface, which the engine holds and returns from
// `engine.debug` (`specs/instrumentation.md`). The level's game mode runs the
// screens and the rules: its `gameStateClass` is `GantryState`, so the engine
// builds that state when the world opens, with every field at its title-screen
// initializer; its `beginPlay` adds a single player possessing nothing, whose
// controller is where the frame's actions and pointer are read, and registers
// the diagnostic sources `specs/instrumentation.md` lists through
// `world.diagnostics`, each a zero-argument pure read of the live state at the
// call; and its `tick` accumulates the frame's delta time and mirrors the
// engine's mute bit into the state. The engine's own documentation, seeded at
// `engine/`, defines all of this and the classes below; read it before you
// start.
//
// THE FRAMEWORK'S STATE IS LIVE. A game state, an actor's transform, a
// component's offset, and the world's camera are objects the game writes into:
// a tick advances the fields it moves in place rather than building a
// replacement. The state below is the whole of the authoritative game — the
// actors, components, and controllers you write draw it and drive it, holding
// nothing authoritative of their own.
//
// A RUN ADVANCES ON THE FIXED TICK. The mode's `tick` consumes whole
// 1/TICK_HZ-second ticks from the accumulated time while a run is in progress,
// each tick the full pipeline `specs/program.md` fixes; nothing ticks on the
// other screens.
//
// THE POINTER comes from the engine, and only through a controller. A player
// controller's input reader reports the pointer already in logical stage units,
// with the frame's ordered samples and its press and release edges, and each
// controller consumes an edge once. Turning a point on the stage into something
// in the yard is the camera's: `world.camera.logicalToRay` casts a world-space
// ray through it, `world.camera.worldToLogical` puts a world point back on the
// stage, and both answer through the camera as it stands at the call.
// `specs/controls.md` states what Gantry picks, in what priority, and within
// what screen distance; how you find it is yours.
//
// THE YARD IS DRAWN THROUGH RENDER COMPONENTS. The engine owns the picture: it
// collects every enabled, visible render component each frame and draws it, so
// the ground, the lights, the lattice and envelope aids, the members colored
// by utilization, the hoist cable, the pads, and the produced models are
// components on actors rather than a scene the game repaints. The readouts go
// over that picture in the screen pass, in the same logical units — text,
// shapes, and sprites for what those describe, and a draw component for
// anything they cannot. The camera is the world's own: the mode writes its
// position and aims it at CAMERA_TARGET, and its projection is a perspective
// frustum unless the game says otherwise.
//
// THE PRODUCED ASSETS ARE YOURS TOO. `specs/assets.md` fixes which tool on this
// container's `PATH` produces each model and sound, and every produced file is
// committed under ASSET_ROOT, which the engine's asset loader resolves every
// path against. That loader is also the decoder: it hands a committed `.glb`
// back as a model whose meshes carry the file's own per-vertex colors, and a
// model component clones one of those onto an actor. A produced model declares
// no material of its own, so those meshes arrive on the loader's default one,
// which is yours to replace.

import { GameInstance, GameMode } from "@clockwyrks/structured-3d";
import type { GameDefinition, InitApi } from "@clockwyrks/structured-3d";
/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the whole canvas is cleared to each frame, so the
 * letterbox bars around the stage match the yard's sky. This placeholder is
 * replaced by the build with the color its yard uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Gantry: src/game.ts is not implemented yet";

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. Register the
 * actions, load the cues and the produced models, and return the debug surface
 * `specs/instrumentation.md` specifies.
 */
class GantryInstance extends GameInstance<GantryDebugApi> {
  override initialize(_api: InitApi): GantryDebugApi {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the lattice
 * editor and the tape editor, the run and its fixed tick, the orbit camera, the
 * single player, and the per-frame bookkeeping the specification asks of every
 * tick.
 */
class GantryMode extends GameMode {
  override gameStateClass = GantryState;
}

/**
 * The game this build's engine drives.
 *
 * Implement the instance and the mode, and split the work across new modules
 * under `src/` however you like. Nothing else in the project needs changing for
 * the game to run: `src/main.ts` already binds this definition to the engine.
 */
export const game: GameDefinition<GantryDebugApi> = {
  instance: GantryInstance,
  levels: { yard: { mode: GantryMode } },
  startLevel: "yard",
};
