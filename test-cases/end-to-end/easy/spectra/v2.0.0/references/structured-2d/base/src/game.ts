// Spectra — the state contract and the framework objects the engine drives.
//
// The game is ONE `GameDefinition` with ONE level. The engine opens that level
// at `startLevel` and the game never opens another: every screen is a value of
// the state's `screen` field, so the world and its game state live for the whole
// session and a wave survives a stage advance without the world being rebuilt
// (`specs/state.md`). `SpectraInstance.initialize` runs once, before the level
// opens — it registers the actions and defines the nine cues, and returns the
// debug surface, which the engine holds and hands back from `engine.debug`
// (`specs/instrumentation.md`). The level's own `load` reads the seeded art, and
// is awaited before any actor of the level exists. `SpectraMode` runs the level:
// its `gameStateClass` is `SpectraState`, so the engine builds the state below
// when the world opens; its `beginPlay` adds the single player — possessing
// nothing — whose controller reads the frame's actions, and registers the
// diagnostic sources; and its `tick` is the whole of the simulation the frame
// owes the game.
//
// THE STATE BELOW IS A CONTRACT (`specs/state.md`). It is the world's game state
// — `engine.world.state` is the one instance of it — and the framework's states
// are LIVE objects: a tick writes the fields it advances in place, and each
// field initializer is that field's title-screen value, the same value the debug
// surface's `reset` restores. It is the whole of the authoritative game: every
// value carried from one frame to the next lives on it, nothing else in this
// build holds game state, and every other module is either arithmetic over these
// fields or a system that writes them through the paths play runs on.
//
// SPECTRA'S SCREENS RUN ON `screen`, NOT ON THE MATCH PHASE. The mode never
// calls `setPhase`, so the inherited match phase stays `"waiting"` and `elapsed`
// stays `0`, and the two vocabularies never meet.

import { GameInstance, GameMode, GameState } from "@clockwyrks/structured-2d";
import type {
  GameDefinition,
  InitApi,
  LoadApi,
  World,
} from "@clockwyrks/structured-2d";
import { syncField } from "./actors";
import { defineCues, playCues } from "./audio";
import { loadArt } from "./assets";
import {
  DEFAULT_SEED,
  DIVE_FIRST_DELAY,
  LEVELS,
  START_LIVES,
  TAGS,
} from "./constants";
import { SpectraController } from "./controller";
import { createDebugApi, type SpectraDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { registerActions } from "./input";
import { newFrameEvents } from "./events";
import { forgetPresses, stepFrame } from "./simulate";
import { Ship, Stage } from "./actors";
import { COLOR } from "./theme";
import type { ParticleSimulator } from "@clockwyrks/particle-runtime";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { SpectraDebugApi };
export type { SpectraSnapshot } from "./debug";

/**
 * The stage background. `src/main.ts` hands it to the engine as the colour the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the field itself.
 */
export const BACKGROUND: string = COLOR.background;

// ---- The declared state (specs/state.md) ---------------------------------

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
 * check turns a wrong wiring into a named error instead of a silent cast.
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
 * action against its bindings, defines the nine cues, and returns the debug
 * surface `specs/instrumentation.md` fixes. The surface reads the live world off
 * the engine at each call, so it holds no state of its own.
 */
class SpectraInstance extends GameInstance<SpectraDebugApi> {
  override initialize(api: InitApi): SpectraDebugApi {
    registerActions(api);
    defineCues(api);
    // A fresh game starts with no press in progress.
    forgetPresses();
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the ship is
 * driven through the state rather than as a pawn — and registers the diagnostic
 * sources with the world's overlay registry. The frame's input is resolved by
 * that player's controller (`src/controller.ts`), which ticks before any actor
 * and before this mode, so the wave this tick advances is advanced under the keys
 * this frame delivered.
 *
 * `tick` is the simulation. Every rate is per second and is integrated inside
 * the sub-step loop `specs/simulation.md` fixes, so an interval of game time
 * reaches the same state however it was divided into frames. The field's actors
 * are brought into line with the rosters at the end of it, before the pipeline
 * renders, so the picture is the frame this tick produced.
 */
class SpectraMode extends GameMode {
  // The state the engine builds when the world opens. The cast is the other
  // half of the note on `SpectraStateBase`: the class IS a `GameState`, and only
  // the type of the one re-typed field keeps TypeScript from saying so.
  override gameStateClass = SpectraState as unknown as new () => GameState;
  override playerControllerClass = SpectraController;
  // The one player possesses nothing: its controller is where the actions are
  // read, and the ship is a field of the game's state rather than a pawn.
  override pawnClass = null;

  override beginPlay(): void {
    this.addPlayer();
    registerDiagnostics(this.world);
    syncField(this.world, spectraState(this.world));
  }

  override tick(dt: number): void {
    const state = spectraState(this.world);
    const player = this.world.players()[0];

    // The frame's input, resolved by the controller that read the keyboard. A
    // frame with no controller yet — which cannot happen once `beginPlay` has
    // run — advances under an idle frame rather than throwing.
    const input =
      player instanceof SpectraController ? player.takeFrameInput() : undefined;

    const events = newFrameEvents();
    if (input !== undefined) stepFrame(state, input, dt, events);

    // The game's readable copy of the runtime's mute bit, refreshed every update
    // (`specs/state.md`). The runtime owns muting; this field is what the
    // snapshot reports.
    state.muted = this.world.audio.muted();
    // While sound is muted the game starts no sound at all: it plays no cue
    // rather than playing one for the bus to silence (`specs/ui.md`).
    if (!state.muted) playCues(this.world.audio, events);

    syncField(this.world, state);
  }
}

/**
 * The game this build's engine drives: the instance, the single level with the
 * stage and the ship in it, and the name `engine.initialize` opens that level
 * under. `src/main.ts` binds it to the engine.
 */
export const game: GameDefinition<SpectraDebugApi> = {
  instance: SpectraInstance,
  levels: {
    [LEVELS.field]: {
      mode: SpectraMode,
      actors: [{ type: Stage }, { type: Ship, tags: [TAGS.ship] }],
      // The seeded art belongs to the one level the game has, and the engine
      // awaits this before any actor of it exists, so every draw reads a plain
      // value (`specs/assets.md`).
      load: (api: LoadApi) => loadArt(api.assets),
    },
  },
  startLevel: LEVELS.field,
};
