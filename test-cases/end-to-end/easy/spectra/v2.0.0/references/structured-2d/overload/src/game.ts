// Spectra — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE `GameDefinition` with ONE level. The engine opens that level
// at `startLevel` and the game never opens another: every screen is a value of
// the state's `screen` field (`specs/state.md`), so the world and its game state
// live for the whole session and a wave survives a stage advance without the
// world being rebuilt. `SpectraInstance.initialize` runs once, before the level
// opens — register the actions, define the ten cues, and return the debug
// surface, which the engine holds and hands back from `engine.debug`.
// `SpectraMode` runs the level: its `gameStateClass` is `SpectraState`, so the
// engine builds the state below when the world opens; its `beginPlay` adds the
// single player (possessing nothing) whose controller reads the frame's actions,
// and registers the diagnostic sources; and its `tick` is the whole of the
// simulation the frame owes the game, followed by the pass that keeps the
// field's actors in step with the rosters the simulation just advanced.
//
// THE STATE BELOW IS A CONTRACT (`specs/state.md`). It is the world's game state
// — `engine.world.state` is the one instance of it — and the framework's states
// are LIVE objects: a tick writes the fields it advances in place, and each
// field initializer is that field's title-screen value, the same value the debug
// surface's `reset` restores. It is the whole of the authoritative game: every
// value carried from one frame to the next lives on it, nothing is kept in a
// module-level variable or a closure, and every other module is either
// arithmetic over these fields or a system that writes them through the paths
// play runs on.
//
// Spectra's screens run on `screen` rather than on the engine's match phase: the
// mode never calls `setPhase`, so the inherited match phase is never written and
// the two vocabularies never meet.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type { ParticleSimulator } from "@test-cabinet/particle-runtime";
import type {
  GameDefinition,
  InitApi,
  LevelDefinition,
  World,
} from "@test-cabinet/structured-2d";
import { defineCues, noCues, playCues } from "./audio";
import { syncField } from "./actors";
import {
  DEFAULT_SEED,
  DIVE_FIRST_DELAY,
  LEVELS,
  START_LIVES,
} from "./constants";
import { SpectraController } from "./controller";
import { createDebugApi, type SpectraDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { registerActions } from "./input";
import { advanceGame } from "./sim";
import { loadArt } from "./sprites";
import { fieldActors } from "./actors";
import { COLOR } from "./theme";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { SpectraDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the colour the
 * canvas is cleared to each frame, so the letterbox bars match the field.
 */
export const BACKGROUND: string = COLOR.space;

// ---- The state contract (specs/state.md) ---------------------------------

export type Screen =
  | "title"
  | "howto"
  | "stageIntro"
  | "inWave"
  | "paused"
  | "stageCleared"
  | "gameOver";

export type Phase = "live" | "ready";

export type Band = "cyan" | "magenta";

export type DroneKind = "shard" | "flux" | "prism";

export type DronePhase = "entering" | "formation" | "diving" | "returning";

export interface ShipState {
  x: number;
  band: Band;
  lockout: number;
  cooldown: number;
  contact: boolean;
}

export interface DischargeState {
  active: boolean;
  radius: number;
}

export interface DroneState {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  band: Band;
  phase: DronePhase;
  phaseClock: number;
  slotX: number;
  slotY: number;
  entryGroup: number;
  bandClock: number;
  shellAlive: boolean;
  shotsFired: number;
  travel: boolean;
  oscillation: boolean;
  fire: boolean;
  charge: number;
  /**
   * Whether the dive this drone is flying is an OVERLOAD PLUNGE rather than a
   * launched dive.
   *
   * `specs/mode.md` gives an overloaded Shard a plunge at `OVERLOAD_DIVE_SCALE`
   * times the dive speed, and a plunge is otherwise indistinguishable from the
   * dive the wave launches: both begin at the drone's slot, in phase `diving`,
   * with the charge back at `0`. The rule therefore cannot be derived from the
   * declared fields, and this is the one field beyond them. It is scoped to the
   * dive it describes — every phase change clears it — and `reset` empties the
   * drone roster, so no drone outlives the values `reset` restores.
   */
  plunge: boolean;
}

export interface BulletState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: Band;
  friendly: boolean;
}

export interface BurstState {
  id: number;
  x: number;
  y: number;
  size: number;
  elapsed: number;
  sim: ParticleSimulator;
}

/**
 * The engine's `GameState`, presented without its own `phase`.
 *
 * `GameState.phase` is the MATCH phase — `waiting`, `playing`, `over` — that a
 * mode moves with `setPhase`. Spectra's `phase` is the sub-phase of the `inWave`
 * SCREEN — `live`, `ready` (`specs/state.md`) — and this game's mode never calls
 * `setPhase`, so no match phase is ever written to the field and the two
 * vocabularies never meet. TypeScript cannot express a subclass that re-types an
 * inherited field, so the base is presented here without the one field this game
 * declares its own vocabulary for. Everything else about `GameState` is
 * inherited unchanged and `instanceof GameState` holds of every instance, which
 * is what the engine builds the state through.
 */
const SpectraStateBase = GameState as unknown as {
  new (): Omit<GameState, "phase">;
};

export class SpectraState extends SpectraStateBase {
  screen: Screen = "title";
  phase: Phase = "live";
  phaseTimer = 0;
  menuIndex = 0;

  score = 0;
  lives = START_LIVES;
  stage = 1;
  extraLifeAwarded = false;
  challengeHits = 0;

  resonance = 0;
  inversion = 0;

  ship: ShipState = {
    x: 640,
    band: "cyan",
    lockout: 0,
    cooldown: 0,
    contact: true,
  };
  discharge: DischargeState = { active: false, radius: 0 };

  drones: DroneState[] = [];
  bullets: BulletState[] = [];
  bursts: BurstState[] = [];

  waveEntry = true;
  diveLaunching = true;
  stageClearing = true;
  entryClock = 0;
  swayClock = 0;
  diveClock = 0;
  diveTarget = DIVE_FIRST_DELAY;

  nextId = 1;
  simTime = 0;
  muted = false;
  rngState = DEFAULT_SEED;
}

/**
 * The open world's state, as the state it is: the mode names `SpectraState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error rather than a silent cast.
 */
export function spectraState(world: World): SpectraState {
  const state = world.state;
  if (!(state instanceof SpectraState)) {
    throw new Error("Spectra: the open world does not hold a SpectraState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) ---------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. It registers every
 * action against its bindings, defines the ten cues, and returns the debug
 * surface `specs/instrumentation.md` fixes. The surface reads the live world off
 * the engine at each call, so it holds no state of its own. The seeded art
 * belongs to one level and is loaded in the level's own `load`, which the engine
 * awaits before any actor of that level exists.
 */
class SpectraInstance extends GameInstance<SpectraDebugApi> {
  override initialize(api: InitApi): SpectraDebugApi {
    registerActions(api);
    defineCues(api);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the ship is
 * driven through the state rather than as a pawn — and registers the diagnostic
 * sources with the world's overlay registry. The player's controller resolves
 * the frame's input into the state (`src/controller.ts`), which is why it is not
 * done here: controllers tick before any actor, so the field is drawn from the
 * state this frame's input produced.
 *
 * `tick` is the simulation. Every rate is per second and integrated against the
 * delta the engine hands it, divided into whole sub-steps of at most
 * `SUBSTEP_MAX` (`specs/simulation.md`), so an interval of game time reaches the
 * same state however it was divided into frames. `syncField` then brings the
 * field's actors into step with the rosters the simulation left behind, so the
 * picture the pipeline draws a moment later is this frame's.
 */
class SpectraMode extends GameMode {
  // The state the engine builds when the world opens. The cast is the other half
  // of the note on `SpectraStateBase`: the class IS a `GameState`, and only the
  // type of the one re-typed field keeps TypeScript from saying so.
  override gameStateClass = SpectraState as unknown as new () => GameState;
  override playerControllerClass = SpectraController;

  override beginPlay(): void {
    // `pawnClass` stays `null`, so the one player possesses nothing; its
    // controller is where the frame's actions are read.
    this.addPlayer();
    registerDiagnostics(this.world);
    syncField(this.world, spectraState(this.world));
  }

  override tick(dt: number): void {
    const state = spectraState(this.world);
    // The game's readable copy of the engine's mute bit, refreshed each frame
    // (specs/state.md). The runtime owns muting; this field is what the snapshot
    // reports.
    state.muted = this.world.audio.muted();

    const cues = noCues();
    advanceGame(state, dt, cues);
    playCues(this.world.audio, cues);

    syncField(this.world, state);
  }
}

/** The one level: the field, its scenery actors, and the seeded art it needs. */
const field: LevelDefinition = {
  mode: SpectraMode,
  actors: fieldActors(),
  async load(api) {
    await loadArt(api.assets);
  },
};

/**
 * The game this build's engine drives: the instance, the single level, and the
 * name `engine.initialize` opens it under. `src/main.ts` binds it to the engine.
 */
export const game: GameDefinition<SpectraDebugApi> = {
  instance: SpectraInstance,
  levels: { [LEVELS.field]: field },
  startLevel: LEVELS.field,
};
