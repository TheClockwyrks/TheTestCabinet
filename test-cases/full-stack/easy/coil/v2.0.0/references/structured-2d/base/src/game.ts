// Coil — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session and starting a round is not a level transition.
// `CoilInstance.initialize` runs once, before the level opens — register the
// actions, define the four cues over the produced files, load the sprite set,
// and return the debug surface, which the engine holds and returns from
// `engine.debug`. `CoilMode` runs the level: its `gameStateClass` is
// `CoilState`, so the engine builds the state below when the world opens; its
// `beginPlay` adds the single player (possessing nothing) whose controller reads
// the frame's actions, and registers the diagnostic sources; and its `tick` is
// the fixed-step clock and the bookkeeping every frame owes the state.
//
// THE STATE BELOW IS A CONTRACT. It is the world's game state —
// `engine.world.state` is the one instance of it — and it is what the debug
// surface in `src/debug.ts` poses and reads, with `specs/instrumentation.md`
// fixing the snapshot taken off it. The framework's states are LIVE objects: a
// tick writes the fields it advances in place, and each field initializer is
// that field's title-screen value, the same value `resetSession` restores. Every
// value carried from one frame to the next lives on it; nothing authoritative is
// kept in a module-level variable or a closure, and every other module is either
// arithmetic over these fields or a system that writes them through the paths
// play runs on. Coil's screens run on `screen` rather than the match phase: the
// mode never calls `setPhase`, so the inherited `phase` stays `"waiting"` and
// `elapsed` stays `0`.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
  WorldAudio,
} from "@test-cabinet/structured-2d";
import { Arena } from "./arena";
import { loadSprites, NO_SPRITES, type SnakeSprites } from "./assets";
import { defineCues, playTickEvents, stopMusicOffTheRound } from "./audio";
import {
  DEFAULT_SEED,
  OBSTACLE_CELLS,
  START_CELLS,
  START_DIR,
  TICK_SECONDS,
  type Cell,
  type Direction,
  type Screen,
} from "./constants";
import { CoilController } from "./controller";
import { createDebugApi, type CoilDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { goTo } from "./flow";
import { registerActions } from "./input";
import { seedState } from "./rng";
import { tick } from "./sim";
import { COLORS } from "./theme";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { CoilDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the board's surround.
 */
export const BACKGROUND: string = COLORS.stage;

// ---- The state contract --------------------------------------------------

export class CoilState extends GameState {
  /** The screen the game is on; a session opens on `title`. */
  screen: Screen = "title";
  /** The highlighted item of the current screen's menu, counted from 0. */
  menuIndex = 0;

  /** The running score of the current round. */
  score = 0;
  /** The highest score reached in this session. */
  best = 0;
  /** The combo multiplier M, in `[1, COMBO_MAX]`. */
  combo = 1;
  /** Seconds of simulation time left on the combo window; `0` is closed. */
  comboWindow = 0;

  /** The engine's mute bit, mirrored into the state every frame. */
  muted = false;
  /** Ticks resolved since the last reset. */
  ticks = 0;
  /** Simulation time accumulated on the playing screen since the last reset. */
  simTime = 0;

  /** The direction the head advances in on the next tick. */
  dir: Direction = START_DIR;
  /** The steering requests waiting on the buffer, oldest first. */
  turns: Direction[] = [];
  /** The chain, head at index 0 and tail at the last index. */
  snake: Cell[] = START_CELLS.map((cell) => ({ col: cell.col, row: cell.row }));
  /** The live pellet, or `null` while no pellet is on the board. */
  pellet: Cell | null = null;
  /** The obstacle cells currently on the board. */
  obstacles: Cell[] = OBSTACLE_CELLS.map((cell) => ({
    col: cell.col,
    row: cell.row,
  }));

  /** Step 1 of the tick, and whether a steering request is taken at all. */
  steering = true;
  /** Steps 2 to 5 of the tick. */
  travel = true;
  /** The placement inside step 5. */
  pelletRespawn = true;

  /** Game time held past the last whole tick, carried into the next frame. */
  accumulator = 0;
  /** Seconds left of the head's bite; `0` is the resting pose. */
  biteRemaining = 0;
  /** The pellet generator's whole state (`src/rng.ts`). */
  rngState = seedState(DEFAULT_SEED);

  /**
   * The produced sprite set the renderer draws the snake from, handed over by
   * the game instance as the world opens. It is loaded art rather than anything
   * a round decides, so no reset replaces it.
   */
  sprites: SnakeSprites = NO_SPRITES;
}

/**
 * The open world's state, as the state it is: the mode names `CoilState` as its
 * `gameStateClass`, so this holds of every world this game opens, and the check
 * turns a wrong wiring into a named error instead of a silent cast.
 */
export function coilState(world: World): CoilState {
  const state = world.state;
  if (!(state instanceof CoilState)) {
    throw new Error("Coil: the open world does not hold a CoilState");
  }
  return state;
}

// ---- The frame -----------------------------------------------------------

/**
 * The slack the accumulator allows a tick boundary.
 *
 * A second delivered as sixty frames of a sixtieth each sums to a hair under a
 * second in binary floating point, and the specification requires it to resolve
 * the same eight ticks a second delivered in one frame does. Comparing against
 * the boundary less this tolerance is what makes the two agree. It is far
 * smaller than any interval a caller can mean, so it never lets an early tick
 * through.
 */
const TICK_EPSILON = 1e-9;

/**
 * Resolve every whole tick the accumulator holds, playing each tick's cues on
 * the tick it resolves.
 *
 * A tick that ends the round moves the game off the `playing` screen, and the
 * loop stops there: nothing advances once a round is over. The time the update
 * was still carrying past that tick is SPENT rather than banked
 * (`specs/movement.md`) — held back, it would be waiting the moment a game was
 * put back on `playing` and would march the chain several cells on the first
 * update after that.
 */
function runTicks(state: CoilState, audio: WorldAudio): void {
  while (state.accumulator >= TICK_SECONDS - TICK_EPSILON) {
    state.accumulator -= TICK_SECONDS;
    const result = tick(state);
    playTickEvents(audio, result.events);
    if (result.ended !== null) {
      state.accumulator = 0;
      goTo(state, result.ended === "cleared" ? "cleared" : "gameover");
      return;
    }
  }
}

// ---- The framework objects -----------------------------------------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * The art and the cues are loaded here rather than in the level's `load` because
 * they belong to the whole game, and the surface reads the live world off the
 * engine at each call, so it holds no state of its own.
 */
class CoilInstance extends GameInstance<CoilDebugApi> {
  /** The produced sprite set, loaded once and handed to each world it opens. */
  private sprites: SnakeSprites = NO_SPRITES;

  override async initialize(api: InitApi): Promise<CoilDebugApi> {
    registerActions(api);
    const [sprites] = await Promise.all([loadSprites(api), defineCues(api)]);
    this.sprites = sprites;
    return createDebugApi(() => this.engine.world);
  }

  /** The loaded art reaches the state that draws it as the world opens. */
  override worldOpened(world: World): void {
    coilState(world).sprites = this.sprites;
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the snake is
 * driven through the state rather than as a pawn — and registers the diagnostic
 * sources with the world's overlay registry. `tick` is the fixed-step clock: the
 * frame's delta is accumulated on the `playing` screen and the simulation
 * advances by the whole `TICK_SECONDS` ticks it completes, carrying the
 * remainder into the next frame, so a second of game time is eight ticks however
 * that second was divided (`specs/movement.md`). The bite, the best score, and
 * the engine's mute bit are the bookkeeping every frame owes the state, whatever
 * the screen.
 */
class CoilMode extends GameMode {
  override gameStateClass = CoilState;
  override playerControllerClass = CoilController;

  override beginPlay(): void {
    // `pawnClass` stays `null`, so the one player possesses nothing; its
    // controller is where the frame's actions are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = coilState(this.world);

    if (state.screen === "playing") {
      state.simTime += dt;
      state.accumulator += dt;
      runTicks(state, this.world.audio);
    }
    stopMusicOffTheRound(state.screen, this.world.audio);

    // The bite runs on the ROUND'S own time (`specs/assets.md`), so it holds the
    // frame it is on behind a pause and on every menu screen, and carries on from
    // there when the round resumes.
    if (state.screen === "playing") {
      state.biteRemaining = Math.max(0, state.biteRemaining - dt);
    }
    // The best rises the instant the live score passes it, during play rather
    // than at the end of a round, so a best posed below the live score is raised
    // back to it on the very next frame.
    state.best = Math.max(state.best, state.score);
    // The game's readable copy of the engine's mute bit, refreshed each frame.
    state.muted = this.world.audio.muted();
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the
 * one actor in it, and the name `engine.initialize` opens the level under.
 * `src/main.ts` binds it to the engine.
 */
export const game: GameDefinition<CoilDebugApi> = {
  instance: CoilInstance,
  levels: { board: { mode: CoilMode, actors: [{ type: Arena }] } },
  startLevel: "board",
};
