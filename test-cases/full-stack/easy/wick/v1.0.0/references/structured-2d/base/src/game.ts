// Wick — the game: the state contract and the framework objects the engine
// drives.
//
// The game is one `GameDefinition` with one level. The engine opens that
// level at `startLevel` and the game never opens another: every screen, the
// title, the how-to, the night, the two overlays, the pause, and the two
// endings, is a value of the state's `screen` field, so the world and its
// game state live for the whole session and starting a run is not a level
// transition. `WickInstance.initialize` runs once, before the level opens:
// it registers the actions, defines the fifteen cues over the produced
// files, loads the produced sprites, and returns the debug surface, which
// the engine holds and returns from `engine.debug`. `WickMode` runs the
// level: its `gameStateClass` is `WickState`, so the engine builds the state
// when the world opens; its `beginPlay` adds the single player possessing the
// lamplighter, whose controller reads the frame's actions, points the camera
// at that pawn, and registers the diagnostic sources; and its `tick` is the
// fixed-step clock, the frame's seconds accumulating and the simulation
// advancing by the whole `TICK_DT` ticks they complete, in the order
// `specs/world.md` fixes, carrying the remainder, plus the per-frame
// bookkeeping: the mute mirror, the two loops, and the actor population
// mirroring the state.
//
// The state is a contract. `WickState`, declared in `src/state.ts` and
// re-exported here as the module contract asks, is the world's game state,
// and it is what the debug surface in `src/debug.ts` poses and reads, with
// `specs/instrumentation.md` fixing the snapshot taken off it. Every contact
// is the simulation's own circle and rectangle math over that state
// (`src/sim/`); no collider component and no engine collision event decides
// one. Wick's screens run on `screen` rather than the match phase, so the
// mode never calls `setPhase` and the inherited `phase` stays `"waiting"`.

import { GameInstance, GameMode } from "@clockwyrks/structured-2d";
import type {
  GameDefinition,
  InitApi,
  Transform,
} from "@clockwyrks/structured-2d";
import {
  GroundActor,
  HudActor,
  LamplighterPawn,
  ScreenActor,
  reconcileActors,
} from "./actors";
import { loadAssets } from "./assets";
import { defineCues, syncLoops } from "./audio";
import { LEVEL_NAME } from "./constants";
import { LamplighterController } from "./controller";
import { createDebugApi, type WickDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { runFrame } from "./flow";
import { registerActions, resetPointer } from "./input";
import { resetGesture } from "./pointer";
import { COLORS } from "./render/theme";
import { WickState, wickState } from "./state";

export type {
  ChestResult,
  EnemyHit,
  EnemyId,
  EnemyState,
  Facing,
  GemState,
  GemTier,
  NextDrop,
  OfferId,
  PassiveId,
  PassiveSlot,
  PickupKind,
  PickupState,
  PlayerState,
  ProjectileState,
  RunState,
  Screen,
  WeaponId,
  WeaponSlot,
  ZoneKind,
  ZoneState,
} from "./state";
export type { WickRect, WickSnapshot } from "./debug";
export type { WickDebugApi };
export { WickState, wickState };

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage match the night.
 */
export const BACKGROUND: string = COLORS.stage;

// ---- The framework objects -----------------------------------------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens: it registers the
 * actions, binds the cues to the produced files, loads the produced sprites,
 * and returns the debug surface built over the live engine, so `engine.debug`
 * follows the one world the game runs in.
 */
class WickInstance extends GameInstance<WickDebugApi> {
  override async initialize(api: InitApi): Promise<WickDebugApi> {
    registerActions(api);
    // The pointing device's contact and any armed gesture belong to the device
    // rather than to the state, so a fresh game starts them fresh here.
    resetPointer();
    resetGesture();
    await Promise.all([defineCues(api), loadAssets(api)]);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the fixed
 * tick and everything it resolves, the single player possessing the
 * lamplighter, the camera on it, the diagnostic sources, and the per-frame
 * bookkeeping the specification asks of every frame.
 */
class WickMode extends GameMode {
  override gameStateClass = WickState;
  override playerControllerClass = LamplighterController;
  override pawnClass = LamplighterPawn;

  override beginPlay(): void {
    // One player, possessing the lamplighter; its controller is where the
    // frame's actions are read. The camera follows that pawn at zoom 1.
    const player = this.addPlayer();
    this.world.camera.follow(player.pawn);
    registerDiagnostics(this.world);
    reconcileActors(this.world, wickState(this.world));
  }

  /** The lamplighter pawn spawns where the state's lamplighter stands. */
  override spawnPoint(): Transform {
    const { player } = wickState(this.world).run;
    return { x: player.x, y: player.y, rotation: 0, scaleX: 1, scaleY: 1 };
  }

  override tick(dt: number): void {
    const world = this.world;
    const state = wickState(world);

    // The fixed timestep: the frame's seconds accumulate on `playing`, whole
    // ticks are consumed in the order `specs/world.md` fixes, and the
    // remainder carries into the next frame. Every cue a tick raises plays
    // on the world's bus as the tick resolves it.
    runFrame(state, dt, (cue) => world.audio.play(cue));

    // The per-frame bookkeeping: the mute mirror, the two loops reconciled
    // from the screen the frame settled on, and the actor population
    // mirroring the state it settled to.
    state.muted = world.audio.muted();
    syncLoops(state, world.audio);
    reconcileActors(world, state);
  }
}

/**
 * The game this build's engine drives: the instance, the single level with
 * its scenery, the ground, the HUD, and the screen chrome, and the name
 * `engine.initialize` opens the level under. `src/main.ts` binds it to the
 * engine.
 */
export const game: GameDefinition<WickDebugApi> = {
  instance: WickInstance,
  levels: {
    [LEVEL_NAME]: {
      mode: WickMode,
      actors: [
        { type: GroundActor },
        { type: HudActor },
        { type: ScreenActor },
      ],
    },
  },
  startLevel: LEVEL_NAME,
};
