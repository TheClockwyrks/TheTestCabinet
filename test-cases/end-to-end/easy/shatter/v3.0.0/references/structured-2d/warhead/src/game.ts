// Shatter — the game: the state contract, and the framework objects the engine
// drives.
//
// The game is ONE `GameDefinition` with ONE level. The engine opens that level
// at `startLevel` and the game never opens another: every screen is a value of
// the state's `screen` field, so the world and its game state live for the whole
// session (`specs/state.md`). `ShatterInstance.initialize` runs once, before the
// level opens — it registers the actions, defines the six cues, and returns the
// debug surface the engine holds and hands back as `engine.debug`.
// `ShatterMode` runs the level: its `gameStateClass` is `ShatterState`, so the
// engine builds the state below when the world opens; its `beginPlay` adds the
// single player, possessing nothing, whose controller reads the frame's actions,
// and registers the diagnostic sources; and its `tick` is the whole of the
// simulation the frame owes the game.
//
// The state below is a contract. It is the world's game state — `world.state` is
// the one instance of it — and the framework's states are live objects: a tick
// writes the fields it advances in place, and each field initializer is that
// field's title-screen value, the same value the debug surface's `reset`
// restores. It is the whole of the authoritative game: every value carried from
// one frame to the next lives on it, nothing is kept in a module-level variable
// or a closure, and every other module is either arithmetic over these fields or
// a system that writes them through the paths play runs on.

import { GameInstance, GameMode, GameState } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi, World } from "@clockwyrks/structured-2d";
import { defineCues, noCues, playCues } from "./audio";
import {
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
import { registerActions } from "./input";
import { advanceGame } from "./sim";
import { Field } from "./stage";
import { COLOR } from "./theme";

// The surface is part of this module's contract and is declared beside the game
// it types, so the type is exported from here whichever module implements it.
export type { ShatterDebugApi };

/**
 * The field's background. `src/main.ts` hands it to the engine as the colour the
 * canvas is cleared to each frame, so the letterbox bars around the field match
 * the field itself.
 */
export const BACKGROUND: string = COLOR.space;

// ---- The state contract (specs/state.md) ---------------------------------

export type Screen = "title" | "howto" | "playing" | "paused" | "gameover";
export type SaucerEdge = "left" | "right";
export type FieldEdge = "top" | "bottom" | "left" | "right";

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
  health: number;
  flash: number;
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
  weave: 1 | -1;
  fireClock: number;
  weaveClock: number;
  age: number;
}

export interface TorpedoState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  life: number;
  homing: boolean;
}

/**
 * The frame's input, resolved by the player controller and read by the ticks it
 * runs. It is a field added beside the declared ones: the specification fixes
 * what the state carries about the WORLD, and this is what the player is doing
 * to it this frame, which a tick would otherwise have to reach the keyboard for.
 */
export interface IntentState {
  turn: number;
  thrust: boolean;
  fire: boolean;
}

/**
 * One pointer or touch contact currently pressed, and where it came down.
 *
 * `entry` is the menu entry the press landed in, or `-1` for a press that began
 * outside every region — which can never confirm, since `specs/ui.md` gives a
 * confirm both of its edges inside one region.
 */
export interface PointerPress {
  /** The pointer this press belongs to. Each touch contact has its own. */
  readonly id: number;
  /** The entry the press came down on, or `-1` for none. */
  readonly entry: number;
  /** The screen it came down on; a press does not survive a screen change. */
  readonly screen: Screen;
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
  torpedoes: TorpedoState[] = [];
  torpedoCharge = 1;

  waveSpawning = true;
  saucerSpawning = true;
  saucerClock = 0;
  saucerDue = SAUCER_FIRST_DELAY;

  nextSaucerEdge: SaucerEdge | null = null;
  nextSaucerRow: number | null = null;
  nextSaucerAim: number | null = null;
  nextRockSpeed: number | null = null;
  nextRecycleEdge: FieldEdge | null = null;

  tickClock = 0;
  nextId = 1;
  simTime = 0;
  muted = false;

  // ---- Added beside the declared fields ----------------------------------

  /** What the player is doing this frame, as the controller resolved it. */
  intent: IntentState = { turn: 0, thrust: false, fire: false };

  /** A torpedo launch armed by a press, spent by the tick that answers it. */
  torpedoRequest = false;

  /** Seconds left on the announcement an awarded ship puts on the field. */
  extraFlash = 0;

  /**
   * Every pointer and touch contact currently pressed, and the menu entry each
   * came down on. `specs/ui.md` gives a confirm two edges that may arrive frames
   * apart, so the entry a press landed in is remembered until its release
   * arrives, per pointer id so a second finger cannot take the first one's press
   * away.
   */
  pointerPresses: PointerPress[] = [];
}

/**
 * The open world's state, as the state it is. The mode names `ShatterState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error rather than a silent cast.
 */
export function shatterState(world: World): ShatterState {
  const state = world.state;
  if (!(state instanceof ShatterState)) {
    throw new Error("Shatter: the open world does not hold a ShatterState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) --------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. It registers every
 * action against its binding, defines the six cues, and returns the debug
 * surface `specs/instrumentation.md` fixes. The surface reads the live world off
 * the engine at each call, so it holds no state of its own.
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
 * flown through the state rather than as a pawn — and registers the diagnostic
 * sources with the world's overlay registry. The player's controller resolves
 * the frame's input into the state (`src/controller.ts`), which is why it is not
 * done here: controllers tick before the mode, so the intent this frame's keys
 * produced is the intent this frame's simulation runs on.
 *
 * `tick` is the simulation. `specs/simulation.md` fixes Shatter's own timestep
 * at `TICK_HZ`, and the engine imposes none, so the delta the frame brings is
 * accumulated in the state and run off in whole ticks with the remainder carried
 * (`src/sim.ts`).
 */
class ShatterMode extends GameMode {
  override gameStateClass = ShatterState;
  override playerControllerClass = ShatterController;

  override beginPlay(): void {
    // `pawnClass` stays `null`, so the one player possesses nothing; its
    // controller is where the frame's actions are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = shatterState(this.world);
    // The game's readable copy of the runtime's mute bit, refreshed in every
    // update (`specs/state.md`). The runtime owns muting; this field is what the
    // snapshot reports.
    state.muted = this.world.audio.muted();

    const cues = noCues();
    advanceGame(state, dt, cues);
    playCues(this.world.audio, cues);
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the
 * one actor in it, and the name `engine.initialize` opens that level under.
 * `src/main.ts` binds it to the engine; the field actor's draw components render
 * the state the mode advances.
 */
export const game: GameDefinition<ShatterDebugApi> = {
  instance: ShatterInstance,
  levels: { [LEVELS.field]: { mode: ShatterMode, actors: [{ type: Field }] } },
  startLevel: LEVELS.field,
};
