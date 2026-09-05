// Arc Foundry — the game: the framework objects the engine drives.
//
// The game is ONE `GameDefinition` with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the state's
// `screen` field, so the world and its game state live for the whole session, and a pose
// that changes the screen takes effect at the call rather than riding a transition.
//
// `FoundryInstance.initialize` runs once, before the level opens: it registers every
// action against its keys, declares the twelve cues and backs each with its produced
// clip, loads every produced sprite and particle system, and returns the debug surface,
// which the engine holds and returns from `engine.debug`. The instance keeps what it
// loaded, because the instance is what outlives a world, and seeds it onto each world's
// state as that world opens.
//
// `FoundryMode` runs the level. Its `gameStateClass` is `FoundryState`, so the engine
// builds the state in `src/state.ts` when the world opens; its `beginPlay` computes the
// ground route the field initializers cannot state, adds the single player possessing
// nothing — whose controller is where the frame's actions and pointer are read — and
// registers the diagnostic sources; and its `tick` is the whole of the frame's
// bookkeeping: advance the simulation by the elapsed time the engine measured, play the
// cues that advance raised, raise the bursts it raised and step the ones already
// playing, and refresh the mirror of the mute bit the runtime owns.
//
// THE ORDER IS THE ENGINE'S, and it is why the split falls where it does. Controllers
// tick first, so the input for this frame is resolved before anything advances; the game
// mode ticks last, after every actor, so it advances a settled world; and the pipeline
// renders after that, so the yard's draw components draw the frame the tick produced.
//
// The camera is left at rest, so world units and the stage's logical units coincide.
// Arc Foundry never calls `setPhase` either: the engine's match phase is not the game's
// build/wave/finale phase, which is `runPhase` on the state.

import { GameInstance, GameMode } from "@clockwyrks/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@clockwyrks/structured-2d";
import { loadAssets, noAssets, type Assets } from "./assets";
import { CUE_SPECS, playFrameCues } from "./audio";
import { FoundryController } from "./controller";
import { createDebugApi, type FoundryDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { registerActions } from "./input";
import { spawnBurst, stepBursts } from "./particles";
import { advance, refreshMaze } from "./sim";
import { FoundryState, foundryState } from "./state";
import { COL } from "./theme";
import { Yard } from "./yard";

// Both halves of the module contract are declared beside the game they type, so they are
// exported from here whichever module implements them.
export { FoundryState };
export type { FoundryDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the canvas is
 * cleared to each frame, so the letterbox bars match the yard itself.
 */
export const BACKGROUND: string = COL.void;

/**
 * The whole game: the one framework object that outlives the world.
 *
 * The produced files are loaded once, here, because they are the whole game's rather
 * than one level's, and they survive every reset the debug surface performs.
 */
class FoundryInstance extends GameInstance<FoundryDebugApi> {
  private assets: Assets = noAssets();

  override async initialize(api: InitApi): Promise<FoundryDebugApi> {
    registerActions(api);
    this.assets = await loadAssets(api, CUE_SPECS);
    return createDebugApi(() => this.engine.world);
  }

  /** Seed the opening world's state with what was loaded before the first frame. */
  override worldOpened(world: World): void {
    foundryState(world).assets = this.assets;
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the build phase and
 * the wave, the single player, and the per-frame bookkeeping.
 */
class FoundryMode extends GameMode {
  declare readonly state: FoundryState;

  override gameStateClass = FoundryState;
  override playerControllerClass = FoundryController;

  override beginPlay(): void {
    // The route around the walls is derived from the map rather than declared, so it is
    // computed once here for the state the engine built.
    refreshMaze(this.state);
    // `pawnClass` stays `null`, so the one player possesses nothing; its controller is
    // where the frame's actions and pointer samples are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const w = this.state;

    // `dt` is already seconds. The multiplier, the fixed tick, and the freeze off the
    // playing screen or under the in-place pause are all inside `advance`.
    advance(w, dt);

    // The advance raised its cues and its effects; the frame that raised them plays
    // them, once each.
    playFrameCues(this.world.audio, w.cueQueue, w.screen === "playing");
    w.cueQueue = [];
    const raised = w.fxQueue;
    w.fxQueue = [];
    const bursts = stepBursts(w.bursts, dt);
    for (const event of raised) {
      const burst = spawnBurst(w.assets, event);
      if (burst) bursts.push(burst);
    }
    w.bursts = bursts;

    // The game's readable copy of the engine's mute bit, refreshed each frame.
    w.muted = this.world.audio.muted();
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the one actor
 * that draws it, and the name `engine.initialize` opens it under.
 */
export const game: GameDefinition<FoundryDebugApi> = {
  instance: FoundryInstance,
  levels: { yard: { mode: FoundryMode, actors: [{ type: Yard }] } },
  startLevel: "yard",
};
