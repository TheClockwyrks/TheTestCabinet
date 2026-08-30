// Floe — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE `GameDefinition` with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session and a level advance in Floe's own sense rearranges the strait rather
// than opening a world (`specs/state.md`).
//
// `FloeInstance.initialize` runs once, before the level opens — register the
// eight actions, define the ten cues, and return the debug surface, which the
// engine holds and hands back as `engine.debug`. The level's `load` decodes the
// seeded art, and the engine awaits it before any actor of the level exists, so a
// body reads its frame as a plain value. `FloeMode` runs the level: its
// `gameStateClass` is `FloeState`, so the world's game state is the state below;
// its `beginPlay` adds the single player, possessing nothing, whose controller
// reads the frame's actions, registers the diagnostic sources, and puts the game
// on its title screen; and its `tick` is the fixed-step clock the whole
// simulation advances on.
//
// THE STATE BELOW IS A CONTRACT (`specs/state.md`). It is the world's game state —
// `engine.world.state` is the one instance of it — and the framework's states are
// LIVE objects: a tick writes the fields it advances in place, and each field
// initializer is that field's title-screen value, the same value the debug
// surface's `reset` restores. The run's figures live here and the strait's bodies
// live in the world as tagged actors (`src/bodies.ts`); nothing is kept in a
// module-level variable or a closure outside those objects.
//
// Floe's screens run on `screen` rather than on the engine's match phase: the
// mode never calls `setPhase`, so the inherited `phase` stays `"waiting"` and
// `elapsed` stays `0`. The mute bit is the engine's own, read live from the
// world's audio rather than copied onto the state.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  LoadApi,
  World,
} from "@test-cabinet/structured-2d";
import { CueBag, defineCues } from "./audio";
import { Critter } from "./bodies";
import {
  DEFAULT_SEED,
  LEVELS,
  START_LIVES,
  TAGS,
  TICK_DT,
  crossingTimer,
} from "./constants";
import { FloeController } from "./controller";
import { createDebugApi, type FloeDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { freshSlots } from "./entities";
import { Hud } from "./hud";
import { registerActions } from "./input";
import { Screens } from "./screens";
import { Strait } from "./scenery";
import {
  clearEdges,
  noIntents,
  present,
  resetGame,
  stepTick,
  type Bus,
  type Intents,
} from "./sim";
import { loadArt } from "./sprites";
import { COLOR } from "./theme";

// The surface is part of the module contract and is declared beside the game
// that returns it, so its types are exported from here whichever module
// implements them.
export type { FloeDebugApi };
export type {
  BearSnapshot,
  CritterSnapshot,
  FloeSnapshot,
  FloeSnapshotShape,
  LaneSnapshot,
  VehicleSnapshot,
} from "./snapshot";

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the strait.
 */
export const BACKGROUND: string = COLOR.background;

// ---- The vocabulary the state is built from (specs/state.md) -------------

/** The screen the game is showing (specs/ui.md). */
export type Screen =
  "title" | "howto" | "playing" | "paused" | "victory" | "gameover";

/** What a crossing is doing (specs/progression.md). */
export type Phase = "crossing" | "dying" | "clearing";

/** A lane's direction: `1` rightward, `-1` leftward. */
export type LaneDir = 1 | -1;

/** A grid direction. */
export type Facing = "up" | "down" | "left" | "right";

/** What the critter is standing on (specs/strait.md). */
export type Footing = "solid" | "floe" | "water";

/** The three vehicle kinds (specs/ice.md). */
export type VehicleKind = "plow" | "dogsled" | "car";

/** The three floe kinds (specs/water.md). */
export type FloeKind = "pan" | "raft3" | "raft4";

/** Either band's item kinds, which is what `ITEM_LEN` is keyed by. */
export type ItemKind = VehicleKind | FloeKind;

/** What took a life, which decides the cue and the effect drawn. */
export type Death = "crush" | "splash" | "caught" | "timeout";

/** One lane's motion. */
export interface LaneState {
  row: number;
  dir: LaneDir;
  speed: number;
}

/**
 * The ring one lane's items wrap around, so the run of item and gap continues
 * unbroken across the strait's edges (`src/lanes.ts`). Not a figure the
 * specification fixes; it is this build's expression of the population model.
 */
export interface LaneRing {
  row: number;
  /** The ring's length, in stage units. */
  trackLen: number;
  /** The ring's left end: an item lives in `[wrapMin, wrapMin + trackLen)`. */
  wrapMin: number;
}

/** One place in the hunt a bear can occupy (specs/hunter.md). */
export interface HuntSlot {
  /** The bear filling it, or `null` while it stands empty. */
  bearId: number | null;
  /** Seconds since it fell empty. */
  emptyFor: number;
}

/** A splash or a spray, drawn in code for a moment after a death. */
export interface Effect {
  /** What it is drawn as. */
  kind: "splash" | "spray";
  /** Its center, in stage units. */
  x: number;
  y: number;
  /** Seconds it has left. */
  life: number;
  /** Seconds it started with. */
  span: number;
}

// ---- The world's game state (specs/state.md) -----------------------------

/**
 * The engine's `GameState` with its own `phase` set aside.
 *
 * `specs/state.md` gives Floe's state a `phase` of the three crossing
 * sub-phases, and the engine's `GameState` already carries a `phase` of its own —
 * the MATCH phase, `waiting`/`playing`/`over`, that its `setPhase` writes. The two
 * are different vocabularies under one name, so the base is named here with the
 * engine's `phase` omitted and the state below declares the specification's over
 * it. This is the only place the overlap is handled, and it is a TYPE
 * accommodation alone: the value is `GameState` itself, so the state the engine
 * builds is a `GameState` in every respect. `FloeMode` never calls `setPhase`, so
 * the engine never writes the field, and the inherited `elapsed` stays `0`
 * because the engine only accumulates it while the match phase reads `playing`.
 */
const CrossingState: new () => Omit<GameState, "phase"> = GameState;

export class FloeState extends CrossingState {
  screen: Screen = "title";
  phase: Phase = "crossing";
  phaseTimer = 0;
  menuIndex = 0;

  level = 1;
  reachedLevel = 1;
  lives = START_LIVES;
  score = 0;
  timer = crossingTimer(1);

  bays: boolean[] = [false, false, false, false, false];
  fishBay: number | null = null;

  iceLanes: LaneState[] = [];
  waterLanes: LaneState[] = [];

  bearEmergence = true;
  catchTest = true;
  fishCadence = true;
  timerRunning = true;

  simTime = 0;
  rngState = DEFAULT_SEED;

  // ---- What the run keeps between ticks beyond the contract above ----
  //
  // `specs/state.md`: "Anything else the run must keep between ticks is a field
  // you add to it." Each of these is the build's expression of a rule the
  // specification states rather than a figure it fixes.

  /** The ring each of the sixteen lanes wraps its items around. */
  laneRings: LaneRing[] = [];

  /** The hunt's slots: one below `SECOND_BEAR_LEVEL`, two from it. */
  slots: HuntSlot[] = freshSlots(1);

  /** Seconds until the bonus catch's next transition: appearing, or leaving. */
  fishTimer = 0;

  /** The bay the previous bonus catch occupied, so the next one moves on. */
  lastFishBay: number | null = null;

  /** What is drawn where a critter went under. Presentational and short-lived. */
  effects: Effect[] = [];

  /** The id the next entity added to the strait takes. */
  nextId = 1;

  /** What is left of the frame's delta, carried into the next frame. */
  accumulator = 0;

  /** The actions this frame resolved to, which the next tick consumes. */
  intents: Intents = noIntents();
}

/**
 * The open world's state, as the state it is.
 *
 * The mode names `FloeState` as its `gameStateClass`, so this holds of every
 * world this game opens, and the check turns a wrong wiring into a named error
 * instead of a silent cast.
 */
export function floeState(world: World): FloeState {
  // Read as `unknown` first: `FloeState` redeclares the engine's `phase`, so
  // narrowing a `GameState` to it would intersect the two vocabularies.
  const state: unknown = world.state;
  if (!(state instanceof FloeState)) {
    throw new Error("Floe: the open world does not hold a FloeState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) --------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. The surface it returns
 * reads the live world off the engine at each call, so it holds no state of its
 * own and follows the world for the life of the build.
 */
class FloeInstance extends GameInstance<FloeDebugApi> {
  override initialize(api: InitApi): FloeDebugApi {
    registerActions(api);
    defineCues(api);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `tick` is the fixed-step clock (`specs/overview.md`): the frame's delta is
 * accumulated and the simulation advances by the whole `TICK_DT` ticks that delta
 * completes, carrying the remainder into the next frame, so the number of ticks
 * run over an interval of game time is the same however that interval was
 * divided into frames. `world.every` is deliberately not used for it: its
 * catch-up is per timer and the whole strait has to advance in lockstep.
 *
 * The bodies are presented once the ticks have run and before the pipeline
 * renders, with the leftover fraction as the interpolation alpha, so the picture
 * is drawn between two ticks.
 */
class FloeMode extends GameMode {
  // `FloeState` sets the engine's own `phase` aside (above), so the class is
  // handed over as the construct signature the engine asks for and the state is
  // read back through `floeState`, which checks it.
  override gameStateClass = FloeState as unknown as new () => GameState;
  override playerControllerClass = FloeController;
  override pawnClass = null;

  /** The cues the tick being run raised, sounded once each when it finishes. */
  private readonly cues = new CueBag();

  override beginPlay(): void {
    // Possesses nothing: the critter is driven through the state rather than as
    // a pawn, and the controller is only how an action reaches the game.
    this.addPlayer();
    registerDiagnostics(this.world);
    resetGame(this.world, floeState(this.world));
  }

  override tick(dt: number): void {
    const state = floeState(this.world);
    const audio = this.world.audio;
    const bus: Bus = {
      cue: (name) => this.cues.add(name),
      muted: () => audio.muted(),
      setMuted: (muted) => audio.setMuted(muted),
    };

    state.accumulator += dt;
    while (state.accumulator >= TICK_DT) {
      state.accumulator -= TICK_DT;
      stepTick(this.world, state, state.intents, TICK_DT, bus);
      // An edge belongs to one tick: the tick that saw it consumed it.
      clearEdges(state.intents);
      this.cues.flush(audio);
    }
    present(this.world, state, state.accumulator / TICK_DT);
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the
 * actors in it, and the name `engine.initialize` opens that level under.
 * `src/main.ts` binds it to the engine.
 */
export const game: GameDefinition<FloeDebugApi> = {
  instance: FloeInstance,
  startLevel: LEVELS.strait,
  levels: {
    [LEVELS.strait]: {
      mode: FloeMode,
      actors: [
        { type: Strait },
        { type: Critter, tags: [TAGS.critter] },
        { type: Hud },
        { type: Screens },
      ],
      load: async (api: LoadApi): Promise<void> => {
        await loadArt(api.assets);
      },
    },
  },
};
