// Facet — the game. THIS IS THE FILE YOU IMPLEMENT.
//
// `src/main.ts`, `src/constants.ts` and the project's configuration are
// supplied with the project and stay as they are. What is missing is the game:
// the state the world holds, the debug surface that poses and reads that state,
// and the definition below.
//
// FIRST, DECLARE AND EXPORT `FacetState`, a class extending the engine's
// `GameState`, exactly as `specs/state.md` fixes it, and `FacetDebugApi`, the
// debug and automation surface `specs/instrumentation.md` specifies. The stub
// below is written against both names, so this project does not compile until
// they exist. The type check failing on a freshly seeded workspace is the
// starting point, not a broken seed.
//
// THEN IMPLEMENT the game inside the engine's framework. The definition below
// registers the single level the whole game runs in: the engine opens it once,
// at `startLevel`, and the game never opens another, since every screen is a
// value of the state's `screen` field. The instance's `initialize` runs once,
// before that level opens: register every action in ACTIONS against its
// BINDINGS, define the nine CUES against the sounds this build produces, and
// return the debug surface, which the engine holds and returns from
// `engine.debug` (`specs/instrumentation.md`). The level's game mode runs the
// screens and the rules: its `gameStateClass` is `FacetState`, so the engine
// builds the state `specs/state.md` declares when the world opens, with every
// field at its title-screen initializer; its `beginPlay` adds a single player
// possessing nothing, whose controller is where the frame's actions and
// pointer are read, and registers the diagnostic sources
// `specs/instrumentation.md` lists through `world.diagnostics`, each a
// function of no arguments that reads the live state at the call; and its
// `tick` accumulates `state.simTime` and mirrors the engine's mute bit into
// `state.muted`. The framework's states are live objects: a tick writes the
// fields it advances in place. The actors, components, and controllers you
// write draw that state and drive it, holding no authoritative state of their
// own. The engine's own documentation, seeded at `engine/`, defines all of
// this and the classes below; read it before you start.
//
// The POINTER comes from the engine as well, and it is what the whole game is
// worked with: a gem is taken hold of by pressing on it, offered onto its
// neighbor by pressing or dragging there, and the move is played by the release.
// Every screen carries pointer targets besides, so a player with nothing but a
// touchscreen reaches all of them. The player controller reads the pointer from
// its input reader already in logical stage units, as the frame's ordered
// samples carrying the press and release edges and the device that drove them.
// The engine's input documentation, seeded at `engine/`, defines the API, and
// `specs/controls.md` states what Facet does with them.
//
// The ART, the EFFECTS and the SOUND are yours to produce as well. Facet ships
// none of them: `specs/assets.md` is the contract for what you make with the
// tools on this machine's `PATH`, where each produced file lands under
// `public/assets/`, and how it is wired in. The sprites and sheets go through
// the engine's asset loading, the cues through its audio, and the `system.json`
// particle systems through `@test-cabinet/particle-runtime`, which is already a
// dependency of this project.

import { GameInstance, GameMode } from "@test-cabinet/structured-2d";
import type { GameDefinition, InitApi } from "@test-cabinet/structured-2d";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage match the field the board sits on. This placeholder is
 * replaced by the build with the color its field uses.
 */
export const BACKGROUND = "#000";

const NOT_IMPLEMENTED = "Facet: src/game.ts is not implemented yet";

/**
 * The whole game: the one framework object that outlives the world.
 *
 * Its `initialize` runs once, before the start level opens. Register the
 * actions, define the cues, and return the debug surface
 * `specs/instrumentation.md` specifies.
 */
class FacetInstance extends GameInstance<FacetDebugApi> {
  override initialize(_api: InitApi): FacetDebugApi {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the single
 * player, and the per-frame bookkeeping the specification asks of every tick.
 */
class FacetMode extends GameMode {
  override gameStateClass = FacetState;
}

/**
 * The game this build's engine drives.
 *
 * Implement the instance and the mode; where their implementation lives under
 * `src/` is your call. Nothing else in the project needs changing for the game
 * to run: `src/main.ts` already binds this definition to the engine.
 */
export const game: GameDefinition<FacetDebugApi> = {
  instance: FacetInstance,
  levels: { board: { mode: FacetMode } },
  startLevel: "board",
};
