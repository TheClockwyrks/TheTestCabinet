// Meltdown — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session. `MeltdownInstance.initialize` runs once, before the level opens —
// register the actions, define the ten cues, and return the debug surface,
// which the engine holds and hands back from `engine.debug`. `MeltdownMode`
// runs the level: its `gameStateClass` is `MeltdownState`, its `beginPlay` adds
// the single player (possessing nothing) whose controller reads the frame's
// actions and pointer, and its `tick` is where the whole simulation advances.
//
// THE SIMULATION BELONGS IN THE MODE'S TICK, and that is a requirement rather
// than a preference. The engine runs the mode after every actor has ticked and
// after collision has been reported, so the mode sees a settled world and knows
// the frame's shot counts — which is what the two-phase heat model needs. A
// per-tower actor tick could not do it: an actor ticking in spawn order would
// read some neighbours' new heats and some neighbours' old ones, which is
// exactly what `specs/heat.md` forbids.
//
// THE STATE SHAPE BELOW IS A CONTRACT (specs/state.md). It is the world's game
// state — `engine.world.state` is the one instance of it — and the framework's
// states are LIVE objects: a tick writes the fields it advances in place, and
// each field initializer is that field's title-screen value, the same value the
// debug surface's `reset` restores. Every value the game carries from one frame
// to the next lives on it; nothing is kept in a module-level variable or a
// closure. The one field added beyond the declaration, `routes`, is derived
// data rebuilt from `towers` whenever the blocked set changes.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@test-cabinet/structured-2d";
import {
  FloorActor,
  PanelActor,
  PreviewActor,
  ScreenActor,
  syncActors,
} from "./actors";
import { defineCues, playCues } from "./audio";
import { MeltdownController } from "./controller";
import {
  DEFAULT_SEED,
  DIFFICULTY_TABLE,
  LEVELS,
  START_LIVES,
  TAGS,
  type DifficultyName,
  type ModeName,
  type TowerType,
  type VentName,
  type SurgeType,
} from "./constants";
import { createDebugApi, type MeltdownDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { registerActions } from "./input";
import { computeRoutes, type Routes } from "./routes";
import { simulate } from "./sim";
import { RGB, css } from "./theme";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { MeltdownDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the reactor itself.
 */
export const BACKGROUND: string = css(RGB.bg);

// ---- The state contract (specs/state.md) ---------------------------------

export type Screen =
  | "title"
  | "modeselect"
  | "difficultyselect"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

export type Phase = "opening" | "building" | "wave";

export interface TowerState {
  id: number;
  type: TowerType;
  col: number;
  row: number;
  rotation: number;
  level: number;
  heat: number;
  tripped: boolean;
  tripTimer: number;
  fireClock: number;
  targeting: number | null;
  firing: boolean;
  kills: number;
  damageDealt: number;
  spent: number;
  fresh: boolean;
  firingEnabled: boolean;
  thermalEnabled: boolean;
}

export interface UnitState {
  id: number;
  type: SurgeType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  slowFactor: number;
  slowTimer: number;
  vent: VentName;
  motion: boolean;
}

export interface BuildState {
  type: TowerType;
  col: number;
  row: number;
  rotation: number;
}

export interface PointerState {
  x: number;
  y: number;
  down: boolean;
}

/**
 * The framework's `GameState` with its own `phase` set aside.
 *
 * The engine's `GameState` carries a `phase` of its own — the MATCH phase,
 * `waiting`/`playing`/`over` — which Meltdown does not use: the mode never
 * calls `setPhase`, so nothing in the engine ever writes it, and the only place
 * the engine reads it is the `elapsed` clock this game does not count by.
 * Meltdown's `phase` is the sub-phase of the `playing` screen that
 * `specs/state.md` declares, a different vocabulary on the same name, so the
 * declaration below states it exactly as the specification does and this alias
 * is what lets it. Setting the match phase aside costs no cast — a constructor
 * of `GameState` is a constructor of any part of it — and the one reconciling
 * cast in this build is on `gameStateClass`, where the engine asks for a
 * constructor of the whole thing.
 */
const StateBase: new () => Omit<GameState, "phase"> = GameState;

export class MeltdownState extends StateBase {
  screen: Screen = "title";
  phase: Phase = "opening";
  menuIndex = 0;

  mode: ModeName = "containment";
  difficulty: DifficultyName = "medium";
  money = DIFFICULTY_TABLE.medium.money;
  lives = START_LIVES;
  score = 0;
  wave = 1;

  buildTimer = 0;
  wavePending = 0;
  spawnClock = 0;
  speed = 1;

  towers: TowerState[] = [];
  surge: UnitState[] = [];

  selected: number | null = null;
  hoverShop: TowerType | null = null;
  build: BuildState | null = null;

  waveSpawning = true;
  pointer: PointerState = { x: 0, y: 0, down: false };
  muted = false;

  nextId = 1;
  simTime = 0;
  rngState = DEFAULT_SEED;

  /**
   * Derived, not declared: the two distance fields and the blocked set they
   * were computed over, rebuilt from `towers` whenever the blocked set changes
   * (specs/state.md, The contract).
   */
  routes: Routes = computeRoutes([]);
}

/**
 * The open world's state, as the state it is: the mode names `MeltdownState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error instead of a silent cast.
 */
export function meltdownState(world: World): MeltdownState {
  const state: unknown = world.state;
  if (!(state instanceof MeltdownState)) {
    throw new Error("Meltdown: the open world does not hold a MeltdownState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) ---------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens: it registers every
 * action against its bindings, defines the ten cues, and returns the debug
 * surface `specs/instrumentation.md` fixes. The surface reads the live world
 * off the engine at each call, so it holds no state of its own.
 */
class MeltdownInstance extends GameInstance<MeltdownDebugApi> {
  override initialize(api: InitApi): MeltdownDebugApi {
    registerActions(api);
    defineCues(api);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the pointer
 * and the menus drive the state rather than a pawn — and registers the
 * diagnostic sources with the world's overlay registry. `tick` advances the
 * whole simulation, in the order `src/sim.ts` fixes, and plays the cues that
 * frame raised.
 */
class MeltdownMode extends GameMode {
  override gameStateClass = MeltdownState as unknown as new () => GameState;
  override playerControllerClass = MeltdownController;

  override beginPlay(): void {
    // `pawnClass` stays `null`, so the one player possesses nothing; its
    // controller is where the frame's actions and pointer samples are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = meltdownState(this.world);

    // The game's readable copy of the engine's mute bit, refreshed each frame
    // whatever the screen (specs/state.md).
    state.muted = this.world.audio.muted();

    // While the game is paused the simulation does not advance and `simTime`
    // holds exactly where it was (specs/waves.md, Pause and speed).
    if (state.screen === "paused") return;

    // The game time this frame advances by: its elapsed time multiplied by the
    // game speed, accumulated on every screen.
    const gameTime = dt * state.speed;
    state.simTime += gameTime;

    playCues(this.world.audio, simulate(state, gameTime));
    syncActors(this.world);
  }
}

/**
 * The game this build's engine drives: the instance, the single level, and the
 * name `engine.initialize` opens it under. `src/main.ts` binds it to the
 * engine; the actors the level declares draw the state the mode advances, and
 * the towers and units the run produces are spawned beside them.
 */
export const game: GameDefinition<MeltdownDebugApi> = {
  instance: MeltdownInstance,
  levels: {
    [LEVELS.floor]: {
      mode: MeltdownMode,
      actors: [
        { type: FloorActor },
        { type: PreviewActor, tags: [TAGS.preview] },
        { type: PanelActor, tags: [TAGS.hud] },
        { type: ScreenActor, tags: [TAGS.hud] },
      ],
    },
  },
  startLevel: LEVELS.floor,
};
