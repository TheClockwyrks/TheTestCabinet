// Kessler — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level
// at `startLevel` and the game never opens another: every screen — the title,
// the how-to, the live field, the wave-clear interstitial, the pause, and the
// game over — is a value of the state's `screen` field, so the world and its
// game state live for the whole session and starting a session is not a level
// transition. `KesslerInstance.initialize` runs once, before the level opens
// — register the actions, define the thirteen cues and the two beds over the
// produced files, load the produced sprites and particle systems, and return
// the debug surface, which the engine holds and returns from `engine.debug`.
// `KesslerMode` runs the level: its `gameStateClass` is `KesslerState`, so
// the engine builds the state below when the world opens; its `beginPlay`
// adds the single player possessing the deflector, whose controller reads the
// frame's actions, and registers the diagnostic sources; and its `tick` is
// the fixed-step clock — the frame's delta accumulates and the simulation
// advances by the whole `TICK_DT` ticks it completes, in the six-step order
// `specs/field.md` fixes, carrying the remainder — plus the per-frame
// bookkeeping: the music bed for the screen, and the actor population
// mirroring the state.
//
// THE STATE IS A CONTRACT. `KesslerState`, declared in `src/state.ts` and
// re-exported here as the module contract asks, is the world's game state —
// `engine.world.state` is the one instance of it — and it is what the debug
// surface in `src/debug.ts` poses and reads, with `specs/instrumentation.md`
// fixing the snapshot taken off it. Every contact is the simulation's own
// polar crossing math over that state (`src/sim.ts`) — no collider components
// and no engine collision events decide one. Kessler's screens run on
// `screen` rather than the match phase: the mode never calls `setPhase`, so
// the inherited `phase` stays `"waiting"`.

import { GameInstance, GameMode } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  Transform,
} from "@test-cabinet/structured-2d";
import {
  FieldActor,
  FxActor,
  HudActor,
  PaddlePawn,
  fxOf,
  reconcileActors,
} from "./actors";
import { loadAssets } from "./assets";
import { defineCues, syncBeds } from "./audio";
import { LEVEL_NAME } from "./constants";
import { KesslerController } from "./controller";
import { createDebugApi, type KesslerDebugApi } from "./debug";
import { runTicks, type TickHooks } from "./flow";
import { registerActions } from "./input";
import { registerDiagnostics } from "./diagnostics";
import { pointAt } from "./polar";
import { kesslerState, KesslerState } from "./state";
import { COLORS } from "./theme";

// The surface and the state are part of the module contract, so both are
// exported from here whichever module implements them.
export type { KesslerDebugApi };
export { KesslerState, kesslerState };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars around the stage
 * match the field.
 */
export const BACKGROUND: string = COLORS.stage;

// ---- The framework objects -----------------------------------------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens: it registers the
 * actions, defines the cues and the beds over the produced files, loads the
 * produced sprites and particle systems, and returns the debug surface built
 * over the live engine, so `engine.debug` follows the one world the game runs
 * in.
 */
class KesslerInstance extends GameInstance<KesslerDebugApi> {
  override async initialize(api: InitApi): Promise<KesslerDebugApi> {
    registerActions(api);
    await Promise.all([defineCues(api), loadAssets(api)]);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the fixed
 * tick and everything it resolves, the single player possessing the
 * deflector, and the per-frame bookkeeping the specification asks of every
 * tick.
 */
class KesslerMode extends GameMode {
  override gameStateClass = KesslerState;
  override playerControllerClass = KesslerController;
  override pawnClass = PaddlePawn;

  override beginPlay(): void {
    // One player, possessing the deflector; its controller is where the
    // frame's actions are read.
    this.addPlayer();
    registerDiagnostics(this.world);
    // The field opens fully populated: one tagged actor per boot-layout
    // target, before the first frame draws.
    reconcileActors(this.world, kesslerState(this.world));
  }

  /** The deflector pawn spawns on its track, at the state's angle. */
  override spawnPoint(): Transform {
    const state = kesslerState(this.world);
    const at = pointAt(178, state.paddleAngleDeg);
    return {
      x: at.x,
      y: at.y,
      rotation: (state.paddleAngleDeg * Math.PI) / 180,
      scaleX: 1,
      scaleY: 1,
    };
  }

  override tick(dt: number): void {
    const state = kesslerState(this.world);
    const world = this.world;
    const hooks: TickHooks = {
      cue: (cue) => world.audio.play(cue),
      particle: (system, x, y) => fxOf(world).spawn(system, x, y),
    };

    // The fixed timestep: the frame's seconds accumulate, whole ticks are
    // consumed in the six-step order `specs/field.md` fixes, and the
    // remainder carries into the next frame (`specs/overview.md`).
    state.accumulator += dt;
    runTicks(state, hooks);

    // The bed for the screen the frame settled on, and the actor population
    // mirroring the state it settled to.
    syncBeds(state.screen, world.audio);
    reconcileActors(world, state);
  }
}

/**
 * The game this build's engine drives: the instance, the single level with
 * its scenery — the field, the effects layer, and the chrome — and the name
 * `engine.initialize` opens the level under. `src/main.ts` binds it to the
 * engine.
 */
export const game: GameDefinition<KesslerDebugApi> = {
  instance: KesslerInstance,
  levels: {
    [LEVEL_NAME]: {
      mode: KesslerMode,
      actors: [{ type: FieldActor }, { type: FxActor }, { type: HudActor }],
    },
  },
  startLevel: LEVEL_NAME,
};
