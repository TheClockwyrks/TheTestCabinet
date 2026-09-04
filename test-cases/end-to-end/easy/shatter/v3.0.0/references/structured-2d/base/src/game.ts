// Shatter — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session. `ShatterInstance.initialize` runs once, before the level opens —
// register the actions, define the six cues, and return the debug surface,
// which the engine holds and returns from `engine.debug`. `ShatterMode` runs
// the level: its `gameStateClass` is `ShatterState`, so the engine builds the
// state below when the world opens; its `beginPlay` adds the single player
// (possessing nothing) whose controller reads the frame's actions, and
// registers the diagnostic sources; and its `tick` is the whole of the
// simulation the frame owes the game.
//
// THE STATE BELOW IS A CONTRACT (`specs/state.md`). It is the world's game
// state — `engine.world.state` is the one instance of it — and the framework's
// states are LIVE objects: a tick writes the fields it advances in place, and
// each field initializer is that field's title-screen value, the same value the
// debug surface's `reset` restores. It is the whole of the authoritative game:
// every value carried from one frame to the next lives on it, nothing is kept
// in a module-level variable or a closure, and every other module is either
// arithmetic over these fields or a system that writes them through the paths
// play runs on.
//
// Shatter's screens run on `screen` rather than on the engine's match phase:
// the mode never calls `setPhase`, so the inherited `phase` stays `"waiting"`
// and `elapsed` stays `0`.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@test-cabinet/structured-2d";
import { defineCues, noCues, playCues } from "./audio";
import {
  DEFAULT_SEED,
  FACE_UP,
  LEVELS,
  SAFE_X,
  SAFE_Y,
  SAUCER_FIRST_DELAY,
  START_LIVES,
  type RockSize,
} from "./constants";
import { ShatterController } from "./controller";
import { createDebugApi, type ShatterDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { Field } from "./field";
import { registerActions } from "./input";
import { advanceFrame } from "./sim";
import { COLOR } from "./theme";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { ShatterDebugApi };

/**
 * The field's background. `src/main.ts` hands it to the engine as the colour
 * the canvas is cleared to each frame, so the letterbox bars around the field
 * match the field itself.
 */
export const BACKGROUND: string = COLOR.space;

// ---- The state contract (specs/state.md) ---------------------------------

export type Screen = "title" | "howto" | "playing" | "paused" | "gameover";

export interface ShipState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  thrusting: boolean;
  invuln: number;
  collision: boolean;
  fireCooldown: number;
}

export interface BulletState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface RockState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  spin: number;
}

export interface SaucerState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mind: boolean;
  gun: boolean;
  travel: boolean;
  fireClock: number;
  weaveClock: number;
  age: number;
}

/**
 * What the player is asking for this frame, resolved out of the registered
 * actions by the player controller and read by every tick the frame runs.
 *
 * It is a field beside the declared ones (`specs/state.md`, The contract): a
 * frame may be worth several ticks, so the intent the frame's keys produced has
 * to outlive the controller's own tick and live where the simulation can read
 * it.
 */
export interface InputIntent {
  left: boolean;
  right: boolean;
  thrust: boolean;
  fire: boolean;
}

export class ShatterState extends GameState {
  screen: Screen = "title";
  menuIndex = 0;

  score = 0;
  lives = START_LIVES;
  wave = 0;
  waveBanner = 0;

  ship: ShipState = {
    x: SAFE_X,
    y: SAFE_Y,
    vx: 0,
    vy: 0,
    angle: FACE_UP,
    thrusting: false,
    invuln: 0,
    collision: true,
    fireCooldown: 0,
  };
  bullets: BulletState[] = [];
  rocks: RockState[] = [];
  saucer: SaucerState | null = null;
  enemyBullets: BulletState[] = [];

  waveSpawning = true;
  saucerSpawning = true;
  saucerClock = 0;
  saucerDue = SAUCER_FIRST_DELAY;

  tickClock = 0;
  nextId = 1;
  simTime = 0;
  muted = false;
  rngState = DEFAULT_SEED;

  // ---- Beside the declared fields, and consistent with them --------------

  /** The frame's resolved input, read by every tick the frame runs. */
  input: InputIntent = {
    left: false,
    right: false,
    thrust: false,
    fire: false,
  };

  /** Seconds left on the notice an awarded ship raises. `0` for none. */
  extraLifeNotice = 0;
}

/**
 * The open world's state, as the state it is: the mode names `ShatterState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error instead of a silent cast.
 */
export function shatterState(world: World): ShatterState {
  const state = world.state;
  if (!(state instanceof ShatterState)) {
    throw new Error("Shatter: the open world does not hold a ShatterState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) ---------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. It registers every
 * action against its bindings, defines the six cues, and returns the debug
 * surface `specs/instrumentation.md` fixes. The surface reads the live world
 * off the engine at each call, so it holds no state of its own.
 */
class ShatterInstance extends GameInstance<ShatterDebugApi> {
  override initialize(api: InitApi): ShatterDebugApi {
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
 * the frame's input into the state (`src/controller.ts`), which is why it is
 * not done here: controllers tick before any actor, so the intent this frame's
 * keys produced is the intent this frame's simulation runs on.
 *
 * `tick` is the simulation. The engine imposes no timestep and hands the frame
 * its real elapsed seconds; `specs/simulation.md` fixes Shatter's own, so the
 * delta is accumulated in the state and whole ticks are run from it with the
 * remainder carried (`src/sim.ts`).
 */
class ShatterMode extends GameMode {
  override gameStateClass = ShatterState;
  override playerControllerClass = ShatterController;
  override pawnClass = null;

  override beginPlay(): void {
    // `pawnClass` is null, so the one player possesses nothing; its controller
    // is where the frame's actions are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = shatterState(this.world);
    const audio = this.world.audio;

    // The game's readable copy of the runtime's mute bit, refreshed in every
    // update on every screen (`specs/state.md`). The runtime owns muting; this
    // field is what the snapshot reports.
    state.muted = audio.muted();

    const cues = noCues();
    advanceFrame(state, dt, cues);
    playCues(audio, state, cues);
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the
 * one actor in it, and the name `engine.initialize` opens the level under.
 * `src/main.ts` binds it to the engine; the field actor's draw components
 * render the state the mode advances.
 */
export const game: GameDefinition<ShatterDebugApi> = {
  instance: ShatterInstance,
  levels: { [LEVELS.field]: { mode: ShatterMode, actors: [{ type: Field }] } },
  startLevel: LEVELS.field,
};
