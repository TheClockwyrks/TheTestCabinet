// Fathom — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session and a dive is not a level transition. `FathomInstance.initialize` runs
// once, before the level opens — register the actions, define the seven cues,
// load the seeded art, and return the debug surface, which the engine holds and
// returns from `engine.debug`. `FathomMode` runs the level: its
// `gameStateClass` is `FathomState`, so the engine builds the state below when
// the world opens; its `beginPlay` adds the single player (possessing nothing)
// whose controller reads the frame's actions and registers the diagnostic
// sources; and its `tick` runs the fixed-step clock every frame owes the
// simulation.
//
// THE STATE BELOW IS A CONTRACT (`specs/state.md`). It is the world's game state
// — `engine.world.state` is the one instance of it — and the framework's states
// are LIVE objects: a tick writes the fields it advances in place, and each
// field initializer is that field's title-screen value, the same value the debug
// surface's `reset` restores. It is the whole of the authoritative game: every
// value carried from one frame to the next lives on it, nothing is kept in a
// module-level variable or a closure, and every other module is either
// arithmetic over these fields or a system that writes them through the paths
// play runs on. Fathom's screens run on `screen` rather than the match phase:
// the mode never calls `setPhase`, so the inherited `phase` stays `"waiting"`
// and `elapsed` stays `0`.

import { GameInstance, GameMode, GameState } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi, World } from "@clockwyrks/structured-2d";
import { defineCues, noCues, playCues } from "./audio";
import { START_LIVES, TICK_DT } from "./constants";
import { FathomController } from "./controller";
import { Forager } from "./creatures";
import type { Drifter, Predator } from "./creatures";
import { createDebugApi, type FathomDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { Fog } from "./fog";
import { layoutTrench } from "./flow";
import type { Dir } from "./grid";
import { registerActions } from "./input";
import type { InkCloud } from "./ink";
import { TRENCH, TRENCH_START } from "./layout";
import { Maze } from "./maze";
import { Rng } from "./rng";
import { stepTick } from "./sim";
import type { SonarPulse } from "./sonar";
import { loadSheets } from "./sprites";
import { COLOR } from "./theme";
import { Trench } from "./trench";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { FathomDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the water.
 */
export const BACKGROUND: string = COLOR.abyss;

// ---- The state contract (specs/state.md) ---------------------------------

/** The seven screens, which are the game's top-level state machine. */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

export class FathomState extends GameState {
  screen: Screen = "title";
  /** The highlighted item of whichever menu the screen is showing. */
  menuIndex = 0;
  /**
   * The title menu's remembered selection: the item last confirmed there, `0`
   * until one has been. Every arrival at the title takes `menuIndex` from it
   * (`specs/ui.md`), and it survives the return a dive is put back by.
   */
  titleIndex = 0;
  /**
   * The menu item a pointer or a finger is currently pressed on, or `null`.
   *
   * A confirm takes both of its edges inside ONE region (`specs/ui.md`), so the
   * region the press landed in has to outlive the frame it landed on. It is
   * derived from the gesture in flight and nothing else, and every arrival at a
   * menu drops it, so no pose can leave a press latched over a menu it was not
   * made on.
   */
  pressedItem: number | null = null;

  depth = 1;
  score = 0;
  lives = START_LIVES;
  /** The game's readable copy of the runtime's mute bit. */
  muted = false;

  /** The standing layout, which `setMaze` replaces with a fixture. */
  maze = new Maze(TRENCH, TRENCH_START);
  /** What the maze has revealed, and what is lit this instant. */
  fog = new Fog();
  /** A plankton per tile, by the tile's own index. */
  plankton: boolean[] = [];
  planktonRemaining = 0;

  forager = new Forager();
  /** The roster of the current depth, in release order. */
  predators: Predator[] = [];
  drifters: Drifter[] = [];
  /** Every wavefront in flight, the forager's pulses and the pings alike. */
  pulses: SonarPulse[] = [];
  inkClouds: InkCloud[] = [];

  sonarCooldown = 0;
  inkCooldown = 0;
  /** What is left of the cadence that admits the next bonus drifter. */
  drifterTimer = 0;
  /** What is left of the dive countdown, and of the cleared interstitial. */
  countdown = 0;
  clearedTimer = 0;
  /** Seconds of live play since the countdown ended: the release schedule. */
  playTime = 0;

  /** The direction the forager travels on, and the keys still held. */
  desired: Dir | null = null;
  heldDirs: Dir[] = [];

  /** The one generator every random draw the game makes runs off. */
  rng = new Rng();
  /** What is left of the frame's delta, carried into the next frame. */
  accumulator = 0;
  simTime = 0;

  constructor() {
    super();
    // The trench, with plankton on every corridor tile, the fog fully
    // unrevealed, and every predator in the den: the maze a title screen sits
    // in front of and the one a dive begins on.
    layoutTrench(this);
  }
}

/**
 * The open world's state, as the state it is: the mode names `FathomState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error instead of a silent cast.
 */
export function fathomState(world: World): FathomState {
  const state = world.state;
  if (!(state instanceof FathomState)) {
    throw new Error("Fathom: the open world does not hold a FathomState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) ---------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. The art is loaded here
 * rather than in the level's `load` because it belongs to the whole game and
 * outlives every transition, and the surface reads the live world off the
 * engine at each call, so it holds no state of its own.
 */
class FathomInstance extends GameInstance<FathomDebugApi> {
  override async initialize(api: InitApi): Promise<FathomDebugApi> {
    registerActions(api);
    defineCues(api);
    await loadSheets(api.assets);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the forager is
 * driven through the state rather than as a pawn — and registers the diagnostic
 * sources with the world's overlay registry. `tick` is the fixed-step clock:
 * the frame's delta is accumulated and the simulation advances by the whole
 * `TICK_DT` ticks it completes, carrying the remainder into the next frame, so
 * the number of ticks run over an interval of game time is the same however
 * that interval was divided into frames (`specs/movement.md`).
 */
class FathomMode extends GameMode {
  override gameStateClass = FathomState;
  override playerControllerClass = FathomController;

  override beginPlay(): void {
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = fathomState(this.world);
    // The game's readable copy of the engine's mute bit, refreshed each frame.
    state.muted = this.world.audio.muted();

    const cues = noCues();
    state.accumulator += dt;
    while (state.accumulator >= TICK_DT) {
      state.accumulator -= TICK_DT;
      stepTick(state, TICK_DT, cues);
    }
    playCues(this.world.audio, cues);
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the
 * one actor in it, and the name `engine.initialize` opens the level under.
 * `src/main.ts` binds it to the engine.
 */
export const game: GameDefinition<FathomDebugApi> = {
  instance: FathomInstance,
  levels: { trench: { mode: FathomMode, actors: [{ type: Trench }] } },
  startLevel: "trench",
};
