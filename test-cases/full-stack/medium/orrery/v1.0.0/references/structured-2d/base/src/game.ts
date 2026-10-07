// Orrery — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen — the title, the
// how-to, the select list, and the editor that hosts both editing and the run —
// is a value of the state's `screen` field, so the world and its game state
// live for the whole session and entering a challenge is not a level
// transition.
//
// `OrreryInstance.initialize` runs once, before the level opens: it registers
// every action in `ACTIONS` against its `BINDINGS`, defines the seven `CUES`
// over the produced files, loads the produced sprites and particle systems, and
// returns the debug surface, which the engine holds and returns from
// `engine.debug` (specs/instrumentation.md).
//
// `OrreryMode` runs the level. Its `gameStateClass` is `OrreryState`, so the
// engine builds the state `specs/state.md` declares when the world opens, with
// every field at its title-screen value. Its `beginPlay` adds the single player
// possessing nothing — whose controller is where the frame's actions and
// pointer samples are read — registers the diagnostic sources, and opens the
// world fully populated. Its `tick` accumulates the frame's seconds into
// `simTime`, advances a running sim by `SPEEDS[speed]` cycles per second with
// every crossed sample and boundary resolved in order, plays the cues and the
// effects the frame raised, keeps the music bed looping, mirrors the engine's
// mute bit into `muted`, and leaves the actor population mirroring the state.
//
// THE MODE IS THE HOST. Cues and effects are ASKED FOR by the rules and drained
// by the frame (`src/host.ts`), which is what lets a debug pose sound nothing
// at the call and still let the edit it committed sound on the next frame
// advanced. The two queues are the mode's, they are emptied every frame, and
// nothing authoritative lives in them: the whole of the game is `OrreryState`.
//
// THE STATE IS A CONTRACT. `OrreryState`, declared in `src/state.ts` and
// re-exported here as the module contract asks, is the world's game state —
// `engine.world.state` is the one instance of it — and it is what the debug
// surface in `src/debug.ts` poses and reads. Every collision is the
// simulation's own sampled rule over that state (`src/collision.ts`): no
// collider components and no engine collision events decide one. Orrery's
// screens run on `screen` rather than the match phase, so the mode never calls
// `setPhase` and the inherited `phase` stays `"waiting"`.

import { GameInstance, GameMode } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi } from "@clockwyrks/structured-2d";
import {
  ChromeActor,
  FieldActor,
  FxActor,
  fxOf,
  reconcileActors,
} from "./actors";
import { loadAssets } from "./assets";
import { defineCues, syncBed } from "./audio";
import { LEVEL_NAME, type CueName } from "./constants";
import { OrreryController } from "./controller";
import { createDebugApi, type OrreryDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import type { ParticleSystemName } from "./figures";
import { advanceFrame } from "./flow";
import { bindHost, hostOf, type EffectEvent, type OrreryHost } from "./host";
import { registerActions } from "./input";
import type { StagePoint } from "./motion";
import { orreryState, OrreryState } from "./state";
import { COLORS } from "./theme";

// The surface and the state are part of the module contract, so both are
// exported from here whichever module implements them.
export type { OrreryDebugApi };
export { OrreryState, orreryState };
export type * from "./types";

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage match the sky itself.
 */
export const BACKGROUND: string = COLORS.sky;

/** How many effects the queue holds before the oldest is dropped. */
const MAX_QUEUED_EFFECTS = 16;

// ---- The framework objects -----------------------------------------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens: it registers the
 * actions, defines the cues over the produced files, loads the produced sprites
 * and particle systems, and returns the debug surface built over the live
 * engine, so `engine.debug` follows the one world the game runs in.
 */
class OrreryInstance extends GameInstance<OrreryDebugApi> {
  override async initialize(api: InitApi): Promise<OrreryDebugApi> {
    registerActions(api);
    await Promise.all([defineCues(api), loadAssets(api)]);
    return createDebugApi(() => hostOf(this.engine.world));
  }
}

/**
 * The rules of the one level the game runs in: the screen machine, the editor,
 * the run and everything a cycle resolves, the single player, and the per-frame
 * bookkeeping the specification asks of every tick.
 */
class OrreryMode extends GameMode implements OrreryHost {
  /**
   * The world's game state, narrowed. The engine builds it from
   * `gameStateClass` and assigns it before `beginPlay`, so the mode IS the host
   * the rules are written against (`src/host.ts`).
   */
  declare readonly state: OrreryState;

  override gameStateClass = OrreryState;
  override playerControllerClass = OrreryController;

  /** The cues this frame raised, played once each when the frame flushes. */
  private readonly queued = new Set<CueName>();
  /** The effects raised since the last frame drained them. */
  private readonly raised: EffectEvent[] = [];

  /** Ask for a cue on this frame. Played once, however often it is asked. */
  cue(cue: CueName): void {
    this.queued.add(cue);
  }

  /** Ask for one produced particle effect, at a position on the stage. */
  effect(system: ParticleSystemName, at: StagePoint): void {
    this.raised.push({ system, at: { x: at.x, y: at.y } });
    // Nothing is obliged to drain them, so the queue is bounded rather than
    // left to grow through a scenario that never draws.
    if (this.raised.length > MAX_QUEUED_EFFECTS) this.raised.shift();
  }

  /** The engine's mute bit, which `state.muted` mirrors every frame. */
  muted(): boolean {
    return this.world.audio.muted();
  }

  /** Toggle the engine's mute bit, which the `mute` action does. */
  toggleMute(): void {
    this.world.audio.setMuted(!this.world.audio.muted());
  }

  override beginPlay(): void {
    // The world's rules run through this mode (`src/host.ts`), so the player
    // controller and the debug surface both reach the live game from the world.
    bindHost(this.world, this);
    // One player, possessing nothing; its controller is where the frame's
    // actions and pointer samples are read.
    this.addPlayer();
    registerDiagnostics(this.world);
    // The world opens fully populated: one tagged actor per placed part, mote,
    // and filament, before the first frame draws.
    reconcileActors(this.world, this.state);
  }

  override tick(dt: number): void {
    // The frame's seconds: `simTime` whatever the screen, and the run advanced
    // by `SPEEDS[speed]` cycles per second of it (specs/simulation.md).
    advanceFrame(this, dt);

    // The cues and the effects the frame raised, played once each. A cue asked
    // for by a debug pose between frames sounds here, on the next frame
    // advanced (specs/instrumentation.md).
    for (const cue of this.queued) this.world.audio.play(cue);
    this.queued.clear();
    const fx = fxOf(this.world);
    for (const event of this.raised.splice(0, this.raised.length)) {
      fx.fire(event);
    }

    // The bed loops from the first frame, on every screen (specs/ui.md).
    syncBed(this.world.audio);

    // The actor population mirroring the state the frame settled on.
    reconcileActors(this.world, this.state);
  }
}

/**
 * The game this build's engine drives: the instance, the single level with the
 * actors that outlive every screen — the field, the effects layer, and the
 * chrome — and the name `engine.initialize` opens the level under.
 * `src/main.ts` binds it to the engine.
 */
export const game: GameDefinition<OrreryDebugApi> = {
  instance: OrreryInstance,
  levels: {
    [LEVEL_NAME]: {
      mode: OrreryMode,
      actors: [{ type: FieldActor }, { type: FxActor }, { type: ChromeActor }],
    },
  },
  startLevel: LEVEL_NAME,
};
